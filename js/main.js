// Multi-Project Workspace System
class Project {
    constructor(name) {
        this.id = Date.now().toString();
        this.name = name || `Project_${this.id}`;
        this.textures = {};
        this.currentTexture = null;
        this.createdAt = new Date();
    }
}

// Global State
let projects = [];
let currentProject = null;
let selectedTool = 'brush';
let currentColor = '#ff0000';
let localAutosaveTimer = null;
let showGridOverlay = true;
let gridOverlayColor = '#444444';
let activeBrushSize = 1;
let isDrawing = false;

const canvas = document.getElementById('editor-canvas');
const ctx = canvas.getContext('2d');
const drawer = document.getElementById('drawer');

/**
 * Initialize the application
 */
function initializeApp() {
    loadProjectsFromStorage();
    setupEventListeners();
    renderProjectsList();
    
    if (projects.length === 0) {
        createNewProject();
    } else {
        switchProject(projects[0].id);
    }
    
    localAutosaveTimer = setInterval(commitToAutosave, 30000);
}

/**
 * Load projects from localStorage
 */
function loadProjectsFromStorage() {
    const stored = localStorage.getItem('cc_projects');
    if (stored) {
        try {
            const data = JSON.parse(stored);
            projects = data.map(p => {
                const proj = new Project(p.name);
                proj.id = p.id;
                proj.createdAt = p.createdAt;
                return proj;
            });
        } catch (e) {
            console.warn('Failed to load projects:', e);
            projects = [];
        }
    }
}

/**
 * Save projects to localStorage
 */
function saveProjectsToStorage() {
    const data = projects.map(p => ({
        id: p.id,
        name: p.name,
        createdAt: p.createdAt
    }));
    localStorage.setItem('cc_projects', JSON.stringify(data));
}

/**
 * Create a new project
 */
function createNewProject() {
    const name = prompt('Enter project name:', `Texture_Pack_${projects.length + 1}`);
    if (!name) return;
    
    const project = new Project(name);
    projects.push(project);
    saveProjectsToStorage();
    switchProject(project.id);
    renderProjectsList();
}

/**
 * Switch to a different project
 */
function switchProject(projectId) {
    currentProject = projects.find(p => p.id === projectId);
    if (!currentProject) return;
    
    clearCanvas();
    renderProjectsList();
    rebuildTextureBrowserGrid();
}

/**
 * Delete a project
 */
function deleteProject(projectId) {
    if (!confirm('Are you sure? This will delete the project.')) return;
    
    projects = projects.filter(p => p.id !== projectId);
    saveProjectsToStorage();
    
    if (currentProject?.id === projectId) {
        currentProject = projects.length > 0 ? projects[0] : null;
        if (!currentProject) createNewProject();
        else switchProject(currentProject.id);
    }
    
    renderProjectsList();
}

/**
 * Render projects list in sidebar
 */
function renderProjectsList() {
    const list = document.getElementById('projects-list');
    list.innerHTML = '';
    
    projects.forEach(project => {
        const div = document.createElement('div');
        div.className = `project-item ${currentProject?.id === project.id ? 'active' : ''}`;
        div.innerHTML = `
            <span class="project-name" title="${project.name}">${project.name}</span>
            <span class="project-delete" onclick="event.stopPropagation(); deleteProject('${project.id}')">✕</span>
        `;
        div.onclick = () => switchProject(project.id);
        list.appendChild(div);
    });
}

/**
 * Clear canvas
 */
function clearCanvas() {
    canvas.width = 0;
    canvas.height = 0;
}

/**
 * Setup all event listeners
 */
function setupEventListeners() {
    document.getElementById('pack-upload').addEventListener('change', handlePackUpload);
    document.getElementById('new-project-btn').addEventListener('click', createNewProject);
    
    canvas.addEventListener('mousedown', (e) => { isDrawing = true; applyPaintAction(e); });
    canvas.addEventListener('mousemove', (e) => { if (isDrawing) applyPaintAction(e); });
    window.addEventListener('mouseup', () => { if(isDrawing) { isDrawing = false; syncThumbnailPreview(); } });
    
    canvas.addEventListener('touchstart', (e) => { isDrawing = true; applyPaintAction(e); }, {passive: false});
    canvas.addEventListener('touchmove', (e) => { if (isDrawing) { e.preventDefault(); applyPaintAction(e); } }, {passive: false});
    window.addEventListener('touchend', () => { if(isDrawing) { isDrawing = false; syncThumbnailPreview(); } });
}

/**
 * Handle title image fallback
 */
function handleTitleImageFallback() {
    const container = document.getElementById('app-header-container');
    container.innerHTML = `<span class="title-fallback-text">CRAFTCANVAS STUDIO</span>`;
}

/**
 * Toggle the asset drawer
 */
function toggleDrawer() {
    const isClosed = drawer.classList.toggle('closed');
    document.getElementById('open-lbl').style.display = isClosed ? 'inline' : 'none';
    document.getElementById('close-lbl').style.display = isClosed ? 'none' : 'inline';
}

/**
 * Open settings modal
 */
function openSettingsModal() { 
    document.getElementById('settings-modal').classList.remove('hidden'); 
}

/**
 * Close settings modal and apply changes
 */
function closeSettingsModal() {
    const secs = parseInt(document.getElementById('sync-interval-input').value) || 30;
    
    if (secs < 5) {
        alert('Autosave interval must be at least 5 seconds');
        return;
    }
    
    clearInterval(localAutosaveTimer);
    localAutosaveTimer = setInterval(commitToAutosave, secs * 1000);
    
    activeBrushSize = parseInt(document.getElementById('brush-size-select').value) || 1;
    document.getElementById('settings-modal').classList.add('hidden');
    if (currentProject?.currentTexture) reRenderWorkspaceView();
}

/**
 * Toggle grid line style
 */
function toggleGridLineStyle() {
    showGridOverlay = document.getElementById('grid-toggle-checkbox').checked;
    gridOverlayColor = document.getElementById('grid-color-picker').value;
    if (currentProject?.currentTexture) reRenderWorkspaceView();
}

/**
 * Handle pack file upload
 */
async function handlePackUpload(e) {
    if (!e.target.files.length || !currentProject) return;
    
    const file = e.target.files[0];
    const loadingModal = document.getElementById('loading-modal');
    const progressFill = document.getElementById('loading-bar-progress');
    
    loadingModal.classList.remove('hidden');
    progressFill.style.width = '15%';

    try {
        const loadedZip = await JSZip.loadAsync(file);
        currentProject.textures = {};
        
        const totalFiles = Object.keys(loadedZip.files).length;
        let processedFiles = 0;

        for (let path in loadedZip.files) {
            processedFiles++;
            if (!loadedZip.files[path].dir && path.match(/\.(png|jpeg|jpg|webp)$/i)) {
                const buffer = await loadedZip.files[path].async('arraybuffer');
                const blob = new Blob([buffer], { type: 'image/png' });
                
                const imgUrl = URL.createObjectURL(blob);
                const sourceImageElement = await imgSetupPromise(imgUrl);
                
                const offscreenCanvas = document.createElement('canvas');
                offscreenCanvas.width = sourceImageElement.width;
                offscreenCanvas.height = sourceImageElement.height;
                const oCtx = offscreenCanvas.getContext('2d');
                oCtx.drawImage(sourceImageElement, 0, 0);

                currentProject.textures[path] = {
                    canvas: offscreenCanvas,
                    ctx: oCtx,
                    url: imgUrl,
                    modified: false
                };
            }
            if (processedFiles % Math.max(1, Math.floor(totalFiles/6)) === 0) {
                progressFill.style.width = `${Math.min(95, (processedFiles / totalFiles) * 100)}%`;
            }
        }
        
        progressFill.style.width = '100%';
        setTimeout(() => {
            loadingModal.classList.add('hidden');
            rebuildTextureBrowserGrid();
            if (Object.keys(currentProject.textures).length > 0) {
                loadTextureToWorkspace(Object.keys(currentProject.textures)[0]);
            }
        }, 300);

    } catch (err) {
        alert('Error reading file: ' + err.message);
        loadingModal.classList.add('hidden');
    }
    
    e.target.value = '';
}

/**
 * Promise wrapper for image loading
 */
function imgSetupPromise(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.src = src;
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    });
}

/**
 * Rebuild the texture browser grid
 */
function rebuildTextureBrowserGrid() {
    const targetGrid = document.getElementById('texture-grid-target');
    targetGrid.innerHTML = '';

    if (!currentProject) return;

    for (let path in currentProject.textures) {
        const fileData = currentProject.textures[path];
        const name = path.split('/').pop();
        
        const card = document.createElement('div');
        card.className = `texture-card ${currentProject.currentTexture === path ? 'active' : ''}`;
        card.dataset.path = path;
        card.innerHTML = `<img src="${fileData.url}" alt="${name}"><span>${name}</span>`;
        card.onclick = () => loadTextureToWorkspace(path);
        targetGrid.appendChild(card);
    }
}

/**
 * Search textures in the grid
 */
function searchTextures() {
    const query = document.getElementById('texture-search').value.toLowerCase();
    document.querySelectorAll('.texture-card').forEach(card => {
        card.style.display = card.dataset.path.toLowerCase().includes(query) ? 'block' : 'none';
    });
}

/**
 * Load a texture to the workspace
 */
function loadTextureToWorkspace(path) {
    if (!currentProject) return;
    
    currentProject.currentTexture = path;
    document.querySelectorAll('.texture-card').forEach(c => c.classList.remove('active'));
    const activeCard = document.querySelector(`.texture-card[data-path="${path}"]`);
    if (activeCard) activeCard.classList.add('active');

    const fileData = currentProject.textures[path];
    if (!fileData) return;
    
    canvas.width = fileData.canvas.width;
    canvas.height = fileData.canvas.height;
    canvas.style.aspectRatio = `${canvas.width} / ${canvas.height}`;
    
    reRenderWorkspaceView();
}

/**
 * Re-render the workspace view
 */
function reRenderWorkspaceView() {
    if (!currentProject?.currentTexture) return;
    
    const fileData = currentProject.textures[currentProject.currentTexture];
    if (!fileData) return;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = false;
    
    // Render checkerboard
    const tileSize = 1; 
    for (let y = 0; y < canvas.height; y += tileSize) {
        for (let x = 0; x < canvas.width; x += tileSize) {
            ctx.fillStyle = ((x + y) % 2 === 0) ? '#b0b0b0' : '#808080';
            ctx.fillRect(x, y, tileSize, tileSize);
        }
    }

    ctx.drawImage(fileData.canvas, 0, 0);

    // Grid overlay
    if (showGridOverlay && canvas.width <= 128) {
        ctx.lineWidth = 0.03;
        ctx.strokeStyle = gridOverlayColor;
        
        for (let i = 0; i <= canvas.width; i++) {
            ctx.beginPath(); 
            ctx.moveTo(i, 0); 
            ctx.lineTo(i, canvas.height); 
            ctx.stroke();
        }
        for (let j = 0; j <= canvas.height; j++) {
            ctx.beginPath(); 
            ctx.moveTo(0, j); 
            ctx.lineTo(canvas.width, j); 
            ctx.stroke();
        }
    }
}

/**
 * Apply paint action at coordinates
 */
function applyPaintAction(e) {
    if (!currentProject?.currentTexture) return;

    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    const targetPixelX = Math.floor(((clientX - rect.left) / rect.width) * canvas.width);
    const targetPixelY = Math.floor(((clientY - rect.top) / rect.height) * canvas.height);

    if (targetPixelX >= 0 && targetPixelX < canvas.width && targetPixelY >= 0 && targetPixelY < canvas.height) {
        const fileData = currentProject.textures[currentProject.currentTexture];
        
        if (selectedTool === 'brush') {
            fileData.ctx.fillStyle = currentColor;
            fileData.ctx.fillRect(targetPixelX, targetPixelY, activeBrushSize, activeBrushSize);
        } else if (selectedTool === 'eraser') {
            fileData.ctx.clearRect(targetPixelX, targetPixelY, activeBrushSize, activeBrushSize);
        }
        
        fileData.modified = true;
        reRenderWorkspaceView();
    }
}

/**
 * Set the current tool
 */
function setTool(tool) {
    selectedTool = tool;
    document.getElementById('btn-brush').style.borderColor = tool === 'brush' ? '#fff' : '#000';
    document.getElementById('btn-eraser').style.borderColor = tool === 'eraser' ? '#fff' : '#000';
}

/**
 * Update the current color
 */
function updateColor(hex) {
    currentColor = hex;
    document.getElementById('color-indicator').style.background = hex;
}

/**
 * Sync thumbnail preview after editing
 */
function syncThumbnailPreview() {
    if (!currentProject?.currentTexture) return;
    
    const fileData = currentProject.textures[currentProject.currentTexture];
    fileData.canvas.toBlob((blob) => {
        if (!blob) return;
        const newUrl = URL.createObjectURL(blob);
        fileData.url = newUrl;
        
        const cardImg = document.querySelector(`.texture-card[data-path="${currentProject.currentTexture}"] img`);
        if (cardImg) cardImg.src = newUrl;
    }, 'image/png');
}

/**
 * Commit current texture to autosave
 */
function commitToAutosave() {
    if (!currentProject?.currentTexture) return;
    
    const fileData = currentProject.textures[currentProject.currentTexture];
    fileData.canvas.toBlob((blob) => {
        if (!blob) return;
        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onloadend = () => {
            localStorage.setItem(`cc_texture_${currentProject.id}_${currentProject.currentTexture}`, reader.result);
        };
    }, 'image/png');
}

/**
 * Export the resource pack as ZIP
 */
async function exportPack() {
    if (!currentProject || Object.keys(currentProject.textures).length === 0) {
        alert('No textures in current project.');
        return;
    }

    const outputZipGenerator = new JSZip();
    for (let path in currentProject.textures) {
        const fileData = currentProject.textures[path];
        const blobData = await new Promise(resolve => fileData.canvas.toBlob(resolve, 'image/png'));
        outputZipGenerator.file(path, blobData);
    }

    const generatedArchiveBlob = await outputZipGenerator.generateAsync({type : 'blob'});
    const downloadAnchor = document.createElement('a');
    downloadAnchor.href = URL.createObjectURL(generatedArchiveBlob);
    downloadAnchor.download = `${currentProject.name}_pack.zip`;
    downloadAnchor.click();
    URL.revokeObjectURL(downloadAnchor.href);
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', initializeApp);
