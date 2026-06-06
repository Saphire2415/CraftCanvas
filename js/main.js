// Global State
let zipVirtualFileSystem = {}; 
let currentActivePath = null;
let selectedTool = 'brush';
let currentColor = '#ff0000';
let localAutosaveTimer = null;

let showGridOverlay = true;
let gridOverlayColor = '#444444';
let activeBrushSize = 1;

const canvas = document.getElementById('editor-canvas');
const ctx = canvas.getContext('2d');
const drawer = document.getElementById('drawer');

let isDrawing = false;

/**
 * Initialize the application
 */
function initializeApp() {
    setupEventListeners();
    localAutosaveTimer = setInterval(commitToAutosave, 30000);
}

/**
 * Setup all event listeners
 */
function setupEventListeners() {
    // File upload
    document.getElementById('pack-upload').addEventListener('change', handlePackUpload);
    
    // Canvas events
    canvas.addEventListener('mousedown', (e) => { isDrawing = true; applyPaintAction(e); });
    canvas.addEventListener('mousemove', (e) => { if (isDrawing) applyPaintAction(e); });
    window.addEventListener('mouseup', () => { if(isDrawing) { isDrawing = false; syncThumbnailPreview(); } });
    
    // Touch events
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
    
    // Validate autosave interval
    if (secs < 5) {
        alert("Autosave interval must be at least 5 seconds");
        return;
    }
    
    clearInterval(localAutosaveTimer);
    localAutosaveTimer = setInterval(commitToAutosave, secs * 1000);
    
    activeBrushSize = parseInt(document.getElementById('brush-size-select').value) || 1;
    document.getElementById('settings-modal').classList.add('hidden');
    if (currentActivePath) reRenderWorkspaceView();
}

/**
 * Toggle grid line style
 */
function toggleGridLineStyle() {
    showGridOverlay = document.getElementById('grid-toggle-checkbox').checked;
    gridOverlayColor = document.getElementById('grid-color-picker').value;
    if (currentActivePath) reRenderWorkspaceView();
}

/**
 * Handle pack file upload
 */
async function handlePackUpload(e) {
    if (!e.target.files.length) return;
    
    const file = e.target.files[0];
    const loadingModal = document.getElementById('loading-modal');
    const progressFill = document.getElementById('loading-bar-progress');
    
    loadingModal.classList.remove('hidden');
    progressFill.style.width = "15%";

    try {
        const loadedZip = await JSZip.loadAsync(file);
        zipVirtualFileSystem = {};
        
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

                zipVirtualFileSystem[path] = {
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
        
        progressFill.style.width = "100%";
        setTimeout(() => {
            loadingModal.classList.add('hidden');
            rebuildTextureBrowserGrid();
            if (Object.keys(zipVirtualFileSystem).length > 0) {
                loadTextureToWorkspace(Object.keys(zipVirtualFileSystem)[0]);
            }
        }, 300);

    } catch (err) {
        alert("Error reading file: " + err.message);
        loadingModal.classList.add('hidden');
    }
    
    // Reset file input
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

    for (let path in zipVirtualFileSystem) {
        const fileData = zipVirtualFileSystem[path];
        const name = path.split('/').pop();
        
        const card = document.createElement('div');
        card.className = `texture-card ${currentActivePath === path ? 'active' : ''}`;
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
    currentActivePath = path;
    document.querySelectorAll('.texture-card').forEach(c => c.classList.remove('active'));
    const activeCard = document.querySelector(`.texture-card[data-path="${path}"]`);
    if (activeCard) activeCard.classList.add('active');

    const fileData = zipVirtualFileSystem[path];
    canvas.width = fileData.canvas.width;
    canvas.height = fileData.canvas.height;
    
    // Lock dynamic aspect ratios directly to CSS properties to resolve scaling deformation
    canvas.style.aspectRatio = `${canvas.width} / ${canvas.height}`;
    
    reRenderWorkspaceView();
}

/**
 * Re-render the workspace view
 */
function reRenderWorkspaceView() {
    if (!currentActivePath) return;
    const fileData = zipVirtualFileSystem[currentActivePath];
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = false;
    
    // 1. Render Perfectly Symmetrical Transparent Checkerboard Pattern Background Blocks
    const tileSize = 1; 
    for (let y = 0; y < canvas.height; y += tileSize) {
        for (let x = 0; x < canvas.width; x += tileSize) {
            ctx.fillStyle = ((x + y) % 2 === 0) ? '#b0b0b0' : '#808080';
            ctx.fillRect(x, y, tileSize, tileSize);
        }
    }

    // 2. Overlay Layer Texture Image Data
    ctx.drawImage(fileData.canvas, 0, 0);

    // 3. Optional Overlay Pixel Isolation Lines
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
    if (!currentActivePath) return;

    const rect = canvas.getBoundingClientRect();
    
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    const targetPixelX = Math.floor(((clientX - rect.left) / rect.width) * canvas.width);
    const targetPixelY = Math.floor(((clientY - rect.top) / rect.height) * canvas.height);

    if (targetPixelX >= 0 && targetPixelX < canvas.width && targetPixelY >= 0 && targetPixelY < canvas.height) {
        const fileData = zipVirtualFileSystem[currentActivePath];
        
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
    if (!currentActivePath) return;
    const fileData = zipVirtualFileSystem[currentActivePath];
    
    fileData.canvas.toBlob((blob) => {
        if (!blob) return;
        const newUrl = URL.createObjectURL(blob);
        fileData.url = newUrl;
        
        const cardImg = document.querySelector(`.texture-card[data-path="${currentActivePath}"] img`);
        if (cardImg) cardImg.src = newUrl;
    }, 'image/png');
}

/**
 * Commit current texture to autosave
 */
function commitToAutosave() {
    if (!currentActivePath) return;
    const fileData = zipVirtualFileSystem[currentActivePath];
    
    fileData.canvas.toBlob((blob) => {
        if (!blob) return;
        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onloadend = () => {
            localStorage.setItem(`cc_save_file:${currentActivePath}`, reader.result);
        };
    }, 'image/png');
}

/**
 * Export the resource pack as ZIP
 */
async function exportPack() {
    if (Object.keys(zipVirtualFileSystem).length === 0) {
        alert("No pack textures loaded.");
        return;
    }

    const outputZipGenerator = new JSZip();
    for (let path in zipVirtualFileSystem) {
        const fileData = zipVirtualFileSystem[path];
        const blobData = await new Promise(resolve => fileData.canvas.toBlob(resolve, 'image/png'));
        outputZipGenerator.file(path, blobData);
    }

    const generatedArchiveBlob = await outputZipGenerator.generateAsync({type : "blob"});
    const downloadAnchor = document.createElement('a');
    downloadAnchor.href = URL.createObjectURL(generatedArchiveBlob);
    downloadAnchor.download = "forge_resource_pack.zip";
    downloadAnchor.click();
    
    // Cleanup
    URL.revokeObjectURL(downloadAnchor.href);
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', initializeApp);
