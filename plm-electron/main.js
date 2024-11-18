const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

// GitHub repository information
const owner = 'jgomez720';
const repo = 'kcl-files';
const branch = 'main';
const token = process.env.GITHUB_TOKEN;

// Ensure cache and screenshots directories exist
const cacheDir = path.join(__dirname, 'cache');
const screenshotsDir = path.join(cacheDir, 'screenshots'); // Store cached screenshots in the cache folder
const shaCachePath = path.join(cacheDir, 'sha-cache.json');
const tempDir = path.join(__dirname, 'temp'); // Temporary directory for KCL files

if (!fs.existsSync(cacheDir)) {
  fs.mkdirSync(cacheDir);
}
if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir);
}
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir);
}

// Load the SHA cache from JSON file, or create a new one
function loadShaCache() {
  if (fs.existsSync(shaCachePath)) {
    console.log('Loading existing SHA cache.');
    return JSON.parse(fs.readFileSync(shaCachePath, 'utf8'));
  }
  console.log('No SHA cache found, creating new one.');
  return {}; // Return an empty object if the cache file doesn't exist
}

// Save the SHA cache back to the JSON file
function saveShaCache(shaCache) {
  console.log('Saving SHA cache to sha-cache.json');
  fs.writeFileSync(shaCachePath, JSON.stringify(shaCache, null, 2)); // Save formatted JSON
}

// Function to extract material-density and unit from the KCL file content
function extractMaterialDensityAndUnit(fileContent) {
  const densityLine = fileContent.split('\n').find(line => line.trim().startsWith('// material-density:'));
  const unitLine = fileContent.split('\n').find(line => line.trim().startsWith('// material-density-units:'));

  let density = null;
  let densityUnit = null;

  if (densityLine) {
    const densityMatch = densityLine.match(/material-density:\s*([\d.]+)/); // Allow spaces after the colon
    if (densityMatch) {
      density = densityMatch[1]; // Extract the density value
    }
  }

  if (unitLine) {
    const unitMatch = unitLine.match(/material-density-units:\s*([\w-]+)/); // Allow spaces after the colon
    if (unitMatch) {
      densityUnit = unitMatch[1]; // Extract the unit
    }
  }

  return { density, densityUnit };
}

// Function to save KCL file locally
async function saveKclFileLocally(fileName, fileContent) {
  const filePath = path.join(tempDir, fileName);
  fs.writeFileSync(filePath, fileContent);
  console.log(`Saved ${fileName} locally at ${filePath}`);
  return filePath;
}

// Function to calculate mass using zoo CLI
async function calculateMass(fileContent, density, densityUnit, fileName) {
  return new Promise(async (resolve, reject) => {
    const { exec } = require('child_process');

    // Save the KCL file locally first
    const localFilePath = await saveKclFileLocally(fileName, fileContent);

    // Extract the units from the KCL file content
    const unitLine = fileContent.split('\n').find(line => line.trim().startsWith('// units ='));
    let srcUnit = 'in'; // Default to inches
    let outputUnit = 'lb'; // Default to pounds

    if (unitLine) {
      const unitMatch = unitLine.match(/units\s*=\s*(\w+)/); // Regex to extract the unit (in or mm)
      if (unitMatch && unitMatch[1]) {
        srcUnit = unitMatch[1].toLowerCase(); // Extract the units (in or mm)
        if (srcUnit === 'mm') {
          outputUnit = 'kg'; // Use kilograms if the source unit is millimeters
        }
      }
    }

    // Log the detected units for debugging
    console.log(`Detected units: ${srcUnit}, output unit: ${outputUnit}`);

    // Update the zoo CLI command based on the detected units
    const command = `zoo kcl mass --material-density=${density} --material-density-unit=${densityUnit} --output-unit=${outputUnit} --src-unit=${srcUnit} --format=json ${localFilePath}`;

    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error calculating mass: ${stderr}`); // Add detailed error logging
        reject(`Error calculating mass: ${stderr}`);
      } else {
        console.log(`zoo CLI output for mass (JSON): ${stdout}`); // Log the JSON output from zoo CLI

        // Try to parse the JSON output
        try {
          const parsedOutput = JSON.parse(stdout);
          if (parsedOutput && parsedOutput.mass && parsedOutput.output_unit) {
            const mass = parseFloat(parsedOutput.mass).toFixed(2); // Truncate to 5 decimal places
            const unit = parsedOutput.output_unit;
            console.log(`Extracted mass: ${mass} ${unit}`); // Log the extracted mass and unit
            resolve({ mass: parseFloat(mass), unit }); // Return the mass and unit
          } else {
            reject('Invalid JSON output: Mass or output unit missing.');
          }
        } catch (jsonError) {
          console.error('Error parsing JSON:', jsonError);
          reject('Failed to parse zoo CLI JSON output.');
        }
      }
    });
  });
}



// Function to fetch KCL files and their SHAs from GitHub
async function fetchKclFilesAndShaFromGitHub() {
  const fetch = (await import('node-fetch')).default;
  const shaCache = loadShaCache(); // Load existing SHA cache

  // Define apiUrl to get KCL files from the GitHub repository
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents?ref=${branch}`;

  try {
    const response = await fetch(apiUrl, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
      throw new Error(`GitHub API returned status: ${response.status}`);
    }

    const files = await response.json();

    for (const file of files) {
      if (file.name.endsWith('.kcl')) {
        const remoteFileSha = file.sha; // Get the SHA value from GitHub
        const fileNameWithoutExt = path.basename(file.name, '.kcl'); // Extract file name without extension

        // Fetch the latest commit info for this file
        const commitUrl = `https://api.github.com/repos/${owner}/${repo}/commits?path=${file.name}&sha=${branch}&per_page=1`;
        const commitResponse = await fetch(commitUrl, {
          headers: {
            'Accept': 'application/vnd.github.v3+json',
            'Authorization': `Bearer ${token}`
          }
        });

        if (!commitResponse.ok) {
          throw new Error(`GitHub API returned status: ${commitResponse.status}`);
        }

        const commitData = await commitResponse.json();
        const lastCommitAuthor = commitData[0]?.commit?.author?.name || 'Unknown';

        console.log(`File: ${fileNameWithoutExt}, Author: ${lastCommitAuthor}`);

        // Update the cache with the author
        shaCache[fileNameWithoutExt] = {
          sha: remoteFileSha,
          mass: shaCache[fileNameWithoutExt]?.mass || null,
          'mass-unit': shaCache[fileNameWithoutExt]?.['mass-unit'] || null,
          author: lastCommitAuthor,  // Add author info to the cache
        };
      }
    }

    saveShaCache(shaCache); // Save the updated SHA cache to the JSON file
    console.log('KCL files and SHA cache have been updated.');
  } catch (error) {
    console.error('Error fetching KCL files from GitHub:', error);
  }
}


// Create the main application window
async function createWindow() {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    }
  });

  win.maximize();
  win.loadFile('index.html');

  // Fetch KCL files and their SHA values when the window is ready
  ipcMain.handle('fetch-kcl-files-and-sha', async () => {
    await fetchKclFilesAndShaFromGitHub();
    return fs.readdirSync(screenshotsDir).filter(file => file.endsWith('.png')); // Return screenshots
  });

  // Handler to fetch screenshots list from cache
  ipcMain.handle('fetch-screenshots', async () => {
    return fs.readdirSync(screenshotsDir).filter(file => file.endsWith('.png')); // Return the list of PNG screenshots
  });

  // Handle KCL file content retrieval directly from GitHub
  ipcMain.handle('fetch-kcl-file-content', async (event, fileName) => {
    const fetch = (await import('node-fetch')).default;
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${fileName}.kcl?ref=${branch}`;

    const response = await fetch(apiUrl, {
      headers: {
        'Accept': 'application/vnd.github.v3.raw', // Get raw file content
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch content for ${fileName}.kcl: GitHub API returned ${response.status}`);
    }

    const fileContent = await response.text(); // Get the raw text content of the file
    return fileContent;
  });
  ipcMain.handle('get-sha-cache', async () => {
    return loadShaCache(); // Return the SHA cache to the renderer
  });

  ipcMain.handle('fetch-commit-history', async (event, fileName) => {
    const fetch = (await import('node-fetch')).default;
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/commits?path=${fileName}.kcl&sha=${branch}`;
  
    try {
      const response = await fetch(apiUrl, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const commitHistory = await response.json();
      return commitHistory;
    } catch (error) {
      console.error('Error fetching commit history:', error);
      return [];
    }
  });

  ipcMain.handle('fetch-versions', async (event, fileName) => {
    try {
      const apiUrl = `https://api.github.com/repos/${owner}/${repo}/commits?path=${fileName}.kcl&sha=${branch}`;
      const response = await fetch(apiUrl, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });
  
      if (!response.ok) {
        throw new Error(`GitHub API returned status: ${response.status}`);
      }
  
      const commits = await response.json();
      return commits.map(commit => ({
        sha: commit.sha,
        date: commit.commit.author.date,
        author: commit.commit.author.name // Include author name here
      }));
    } catch (error) {
      console.error('Error fetching versions from GitHub:', error);
      throw error;
    }
  });
  

  // Handler to fetch KCL file content by SHA
  ipcMain.handle('fetch-kcl-file-content-by-sha', async (event, fileName, sha) => {
    try {
      const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${fileName}.kcl?ref=${sha}`;
      const response = await fetch(apiUrl, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github.v3.raw',
        }
      });

      if (!response.ok) {
        throw new Error(`GitHub API returned status: ${response.status}`);
      }

      const fileContent = await response.text();
      return fileContent;
    } catch (error) {
      console.error(`Error fetching file content by SHA for ${fileName}:`, error);
      throw error;
    }
  });
  
  ipcMain.handle('fetch-kcl-file-content-version', async (event, { fileName, sha }) => {
    const fetch = (await import('node-fetch')).default;
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${fileName}.kcl?ref=${sha}`;
  
    const response = await fetch(apiUrl, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'Authorization': `Bearer ${token}`
      }
    });
  
    if (!response.ok) {
      throw new Error(`Failed to fetch content for ${fileName}.kcl from SHA: ${sha}`);
    }
  
    const fileContent = await response.json();
    return {
      content: fileContent.content, // Return the base64 content to decode on the frontend
    };
  });  

  // Handler to fetch commit author by SHA
  ipcMain.handle('fetch-commit-author', async (event, fileName, sha) => {
    try {
      const apiUrl = `https://api.github.com/repos/${owner}/${repo}/commits/${sha}`;
      const response = await fetch(apiUrl, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });

      if (!response.ok) {
        throw new Error(`GitHub API returned status: ${response.status}`);
      }

      const commitData = await response.json();
      return { author: commitData.commit.author.name };
    } catch (error) {
      console.error(`Error fetching commit author for SHA ${sha}:`, error);
      throw error;
    }
  });

  ipcMain.handle('fetch-latest-author', async (event, fileName) => {
    try {
      const apiUrl = `https://api.github.com/repos/${owner}/${repo}/commits?path=${fileName}.kcl&sha=${branch}&per_page=1`;
      const response = await fetch(apiUrl, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });
  
      if (!response.ok) {
        throw new Error(`GitHub API returned status: ${response.status}`);
      }
  
      const commits = await response.json();
      return commits[0]?.commit?.author?.name || 'Unknown'; // Return the most recent commit author
    } catch (error) {
      console.error('Error fetching latest author from GitHub:', error);
      return 'Unknown';
    }
  });
}

app.whenReady().then(async () => {
  // On first run, fetch screenshots from GitHub and check SHAs
  await fetchKclFilesAndShaFromGitHub();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  fs.rm(path.join(__dirname, 'temp'), { recursive: true, force: true }, (err) => {
    if (err) {
        console.error(err);
    } else {
        console.log('Directory removed');
    }
  })
  if (process.platform !== 'darwin') app.quit();
});
