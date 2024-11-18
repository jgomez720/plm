const { ipcRenderer } = require('electron');

// Function to load KCL files list and display content when clicked
async function loadKclFiles() {
  try {
    const kclFiles = await ipcRenderer.invoke('fetch-screenshots');
    const shaCache = await ipcRenderer.invoke('get-sha-cache');

    const filesList = document.getElementById('files');
    const fileDisplayTitle = document.getElementById('file-title');
    const snapshotImage = document.getElementById('snapshot-image');
    const massInfo = document.getElementById('mass-info');
    const authorInfo = document.getElementById('author-info'); // Reference to the new author div

    kclFiles.forEach((file) => {
      const fileNameWithoutExt = file.replace('.png', ''); // Remove extension to get the KCL file name
      const listItem = document.createElement('li');
      const ellipsis = document.createElement('span');
      ellipsis.classList.add('ellipsis');
      ellipsis.innerHTML = '...';

      const fileNameDiv = document.createElement('div');
      fileNameDiv.classList.add('file-item-title');
      fileNameDiv.innerText = fileNameWithoutExt;

      // Append title and ellipsis
      listItem.appendChild(fileNameDiv);
      listItem.appendChild(ellipsis);

      // When the file name is clicked, show the screenshot, mass, and author
      listItem.addEventListener('click', async () => {
        const mass = shaCache[fileNameWithoutExt]?.mass || 'N/A';
        const massUnit = shaCache[fileNameWithoutExt]?.['mass-unit'] || '';
        const author = shaCache[fileNameWithoutExt]?.author || 'Unknown';
        fileDisplayTitle.innerText = fileNameWithoutExt;
        snapshotImage.src = `cache/screenshots/${fileNameWithoutExt}.png`; // Show the cached image
        snapshotImage.style.display = 'block';
        massInfo.innerHTML = `Mass: ${mass} ${massUnit}`; // Display mass
        authorInfo.innerHTML = `Author: ${author}`; // Display author
        massInfo.style.display = 'block';
        authorInfo.style.display = 'block'; // Ensure the author div is visible
      });

      // Fetch the latest author when loading the file list
      ipcRenderer.invoke('fetch-latest-author', fileNameWithoutExt).then((author) => {
        shaCache[fileNameWithoutExt].author = author || 'Unknown'; // Add the author to the shaCache
      });

      // When the ellipsis is clicked, fetch and display previous versions
      ellipsis.addEventListener('click', async (event) => {
        event.stopPropagation(); // Prevent triggering the main list item click
        const versions = await ipcRenderer.invoke('fetch-versions', fileNameWithoutExt);
        showVersionPopup(event, versions, fileNameWithoutExt, shaCache); // Pass shaCache here
      });

      filesList.appendChild(listItem);
    });
  } catch (error) {
    console.error('Error loading KCL files:', error);
  }
}


// Function to show previous versions in a pop-up near the cursor
// Function to show previous versions in a pop-up near the cursor
function showVersionPopup(event, versions, fileName, shaCache) {
  // Remove any existing pop-up
  const existingPopup = document.getElementById('version-popup');
  if (existingPopup) {
    existingPopup.remove();
  }

  // Create a new pop-up div
  const versionPopup = document.createElement('div');
  versionPopup.id = 'version-popup';
  versionPopup.classList.add('version-popup');

  // Populate the pop-up with version items
  versions.forEach((version) => {
    const versionItem = document.createElement('div');
    versionItem.classList.add('version-item');
    versionItem.innerText = `SHA: ${version.sha.substring(0, 7)}`; // Show part of the SHA for brevity

    // When a version is clicked, fetch the file content by SHA and navigate to file-viewer.html
    versionItem.addEventListener('click', async () => {
      const kclFileContent = await ipcRenderer.invoke('fetch-kcl-file-content-by-sha', fileName, version.sha);
      
      // Save the file content and metadata in localStorage
      localStorage.setItem('kclFileContent', kclFileContent);
      localStorage.setItem('kclFileName', fileName);
      localStorage.setItem('kclFileMass', `${shaCache[fileName]?.mass || 'N/A'} ${shaCache[fileName]?.['mass-unit'] || ''}`);
      localStorage.setItem('kclFileSnapshot', `cache/screenshots/${fileName}.png`);
      localStorage.setItem('kclFileAuthor', version.author || 'Unknown'); // Save the correct author

      // Navigate to file-viewer.html to display the content
      window.location.href = 'file-viewer.html';
    });

    versionPopup.appendChild(versionItem);
  });

  // Position the pop-up at the cursor's location
  versionPopup.style.left = `${event.pageX}px`;
  versionPopup.style.top = `${event.pageY}px`;

  // Append the pop-up to the body
  document.body.appendChild(versionPopup);

  // Close the pop-up if clicking outside
  document.addEventListener('click', (e) => {
    if (!versionPopup.contains(e.target)) {
      versionPopup.remove();
    }
  }, { once: true });
}

// Function to check if `window.onload` is firing
window.onload = () => {
  if (document.getElementById('files')) {
    loadKclFiles();
  }
};
