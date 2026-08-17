// Formix PDF - Main App Logic

const { jsPDF } = window.jspdf;

// State
let currentTemplate = "invoice";
let lastPdfDoc = null;
let lastPdfBlobUrl = null;
let lastPdfFileName = "";
let scannedImages = [];
let companyLogoDataUrl = null; // base64 logo for invoices

// Storage keys
const SUB_KEY = "formix_subscription";
const PREFS_KEY = "formix_prefs";
const CUSTOMERS_KEY = "formix_customers";
const HISTORY_KEY = "formix_history";
const MAX_HISTORY = 20;
const FIRST_OPEN_KEY = "formix_first_open";
// ========== STRIPE CONFIG ==========
// 1. Create a Product in Stripe: "Formix PDF Pro" · $5 / month
// 2. Create a Payment Link for that product (with optional 7-day trial)
// 3. Paste the Payment Link URL below (must start with https://buy.stripe.com/...)
// Leave empty until you have the link — trial still works offline.
const STRIPE_PAYMENT_LINK = "https://buy.stripe.com/9B67sN5P8ggYfrYe0PcfK00";
const STRIPE_CUSTOMER_PORTAL_LINK = "https://billing.stripe.com/p/login/9B67sN5P8ggYfrYe0PcfK00";
// ========== SUPABASE ==========
const SUPABASE_URL = "https://ccqbbvzeqfqbckacakqn.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_jMl1GTjO8_pAOFWAZKmgPA_Vcc25PZk";

const sb = window.supabase
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

let currentUser = null;
let realSubscription = null;
// DOM Elements
const formTitle = document.getElementById("formTitle");
const pdfForm = document.getElementById("pdfForm");
const backBtn = document.getElementById("backBtn");
const downloadBtn = document.getElementById("downloadBtn");
const newBtn = document.getElementById("newBtn");
const subscribeBtn = document.getElementById("subscribeBtn");
const shareBtn = document.getElementById("shareBtn");
const saveHistoryBtn = document.getElementById("saveHistoryBtn");
const pdfPreviewFrame = document.getElementById("pdfPreviewFrame");

// Scan elements
const scanBackBtn = document.getElementById("scanBackBtn");
const scanCameraInput = document.getElementById("scanCameraInput");
const scanGalleryInput = document.getElementById("scanGalleryInput");
const scanPreviews = document.getElementById("scanPreviews");
const scanOptions = document.getElementById("scanOptions");
const autoCropCheck = document.getElementById("autoCropCheck");
const createScanPdfBtn = document.getElementById("createScanPdfBtn");
const clearScansBtn = document.getElementById("clearScansBtn");
let currentScanFilter = "color"; // color | photo | grayscale | bw | document

// Customer elements
const customerSelect = document.getElementById("customerSelect");
const saveCustomerCheck = document.getElementById("saveCustomerCheck");
const manageCustomersBtn = document.getElementById("manageCustomersBtn");

// Logo elements
const logoInput = document.getElementById("logoInput");
const logoPreview = document.getElementById("logoPreview");
const logoPreviewImg = document.getElementById("logoPreviewImg");
const removeLogoBtn = document.getElementById("removeLogoBtn");

// AI elements
const aiBackBtn = document.getElementById("aiBackBtn");
const aiInput = document.getElementById("aiInput");
const aiOutput = document.getElementById("aiOutput");
const aiResultGroup = document.getElementById("aiResultGroup");
const aiCopyBtn = document.getElementById("aiCopyBtn");
const aiUseNotesBtn = document.getElementById("aiUseNotesBtn");

// Template titles
const templateTitles = {
  invoice: "Create Invoice",
  quote: "Create Quote",
  contract: "Create Contract",
  report: "Create Report",
  form: "Create Form",
  ai: "AI Tools",
  scan: "Scan Document"
};

// Show a specific screen
function showScreen(screenId) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById(screenId).classList.add("active");
}

// Feature cards
document.querySelectorAll(".feature-card").forEach(card => {
  card.addEventListener("click", () => {
    // Check anonymous trial before allowing feature use
    if (isAnonymousTrialExpired()) {
      alert("Your free 3-day trial has ended.\n\nPlease sign in with Google to continue using Formix PDF.");
      showScreen("accountScreen");
      return;
    }

    currentTemplate = card.dataset.template;

    if (currentTemplate === "scan") {
      showScreen("scanScreen");
      return;
    }
    if (currentTemplate === "ai") {
      showScreen("aiScreen");
      return;
    }

    formTitle.textContent = templateTitles[currentTemplate] || "Create Document";
    showScreen("formScreen");
  });
});

// Back buttons
backBtn.addEventListener("click", () => showScreen("home"));
scanBackBtn.addEventListener("click", () => showScreen("home"));
if (aiBackBtn) aiBackBtn.addEventListener("click", () => showScreen("home"));

// ========== LOGO UPLOAD ==========
if (logoInput) {
  logoInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      companyLogoDataUrl = ev.target.result;
      logoPreviewImg.src = companyLogoDataUrl;
      logoPreview.style.display = "block";
    };
    reader.readAsDataURL(file);
  });
}

if (removeLogoBtn) {
  removeLogoBtn.addEventListener("click", () => {
    companyLogoDataUrl = null;
    logoPreview.style.display = "none";
    logoPreviewImg.src = "";
    if (logoInput) logoInput.value = "";
  });
}

// ========== SCAN FUNCTIONALITY ==========

async function addScanFile(file) {
  if (!file || !file.type.startsWith("image/")) return;
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = async (event) => {
      const dataUrl = event.target.result;
      const doCrop = autoCropCheck ? autoCropCheck.checked : true;
      const cropped = await processDocumentImage(dataUrl, doCrop);
      scannedImages.push({
        original: dataUrl,
        cropped: cropped,
        manualCrop: null,
        cropNorm: null,
        filter: currentScanFilter || "color",
        filterCache: {},
      });
      resolve();
    };
    reader.readAsDataURL(file);
  });
}

async function handleScanFiles(fileList) {
  const files = Array.from(fileList || []);
  if (files.length === 0) return;
  for (const file of files) {
    await addScanFile(file);
  }
  renderScanPreviews();
  scanOptions.style.display = "flex";
}

// Camera (forces camera on mobile)
if (scanCameraInput) {
  scanCameraInput.addEventListener("change", async (e) => {
     await handleScanFiles(e.target.files);
    scanCameraInput.value = "";
  });
}

// Gallery (multiple images allowed)
if (scanGalleryInput) {
  scanGalleryInput.addEventListener("change", async (e) => {
    await handleScanFiles(e.target.files);
    scanGalleryInput.value = "";
  });
}
// Add more pages buttons
document.getElementById("addMoreCameraBtn")?.addEventListener("click", () => {
  scanCameraInput?.click();
});

document.getElementById("addMoreGalleryBtn")?.addEventListener("click", () => {
  scanGalleryInput?.click();
});
/**
 * Resize + optional auto-crop. Returns color cropped image.
 */
function processDocumentImage(dataUrl, doCrop = true) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      // --- 1. Resize ---
      const maxSide = 1600;
      let w = img.width;
      let h = img.height;
      if (Math.max(w, h) > maxSide) {
        if (w > h) {
          h = Math.round((h * maxSide) / w);
          w = maxSide;
        } else {
          w = Math.round((w * maxSide) / h);
          h = maxSide;
        }
      }

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      canvas.width = w;
      canvas.height = h;
      ctx.drawImage(img, 0, 0, w, h);

      if (!doCrop) {
        resolve(canvas.toDataURL("image/jpeg", 0.92));
        return;
      }

      const imageData = ctx.getImageData(0, 0, w, h);
      const data = imageData.data;

      // --- 2. Find content bounding box ---
      const gray = new Uint8ClampedArray(w * h);
      for (let i = 0, j = 0; i < data.length; i += 4, j++) {
        gray[j] = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      }

      const sample = (x, y) => gray[y * w + x];
      const bg =
        (sample(2, 2) + sample(w - 3, 2) + sample(2, h - 3) + sample(w - 3, h - 3)) / 4;

      const threshold = 28;
      let minX = w, minY = h, maxX = 0, maxY = 0;
      let found = false;

      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (Math.abs(gray[y * w + x] - bg) > threshold) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
            found = true;
          }
        }
      }

      const pad = 8;
      if (found && maxX - minX > 40 && maxY - minY > 40) {
        minX = Math.max(0, minX - pad);
        minY = Math.max(0, minY - pad);
        maxX = Math.min(w - 1, maxX + pad);
        maxY = Math.min(h - 1, maxY + pad);
      } else {
        minX = 0; minY = 0; maxX = w - 1; maxY = h - 1;
      }

      const cropW = maxX - minX + 1;
      const cropH = maxY - minY + 1;
      const cropCanvas = document.createElement("canvas");
      const cropCtx = cropCanvas.getContext("2d");
      cropCanvas.width = cropW;
      cropCanvas.height = cropH;
      cropCtx.drawImage(canvas, minX, minY, cropW, cropH, 0, 0, cropW, cropH);

      resolve(cropCanvas.toDataURL("image/jpeg", 0.92));
    };
    img.src = dataUrl;
  });
}

/**
 * Apply visual filter to an image data URL.
 * Filters: color | photo | grayscale | bw | document
 */
function applyScanFilter(dataUrl, filter) {
  if (!filter || filter === "color") {
    return Promise.resolve(dataUrl);
  }
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const d = imageData.data;

      for (let i = 0; i < d.length; i += 4) {
        let r = d[i], g = d[i + 1], b = d[i + 2];

        if (filter === "photo") {
          // Slight contrast + warmth for photos
          r = Math.min(255, ((r - 128) * 1.15) + 128 + 6);
          g = Math.min(255, ((g - 128) * 1.12) + 128 + 3);
          b = Math.min(255, ((b - 128) * 1.08) + 128);
        } else if (filter === "grayscale") {
          const val = r * 0.299 + g * 0.587 + b * 0.114;
          r = g = b = val;
        } else if (filter === "bw") {
          // Hard black & white
          let val = r * 0.299 + g * 0.587 + b * 0.114;
          val = val > 140 ? 255 : 0;
          r = g = b = val;
        } else if (filter === "document") {
          // Clean document look (strong contrast + soft threshold)
          let val = r * 0.299 + g * 0.587 + b * 0.114;
          val = ((val - 128) * 1.6) + 128 + 10;
          if (val > 205) val = 255;
          else if (val < 45) val = 0;
          r = g = b = Math.max(0, Math.min(255, val));
        }

        d[i] = Math.max(0, Math.min(255, r));
        d[i + 1] = Math.max(0, Math.min(255, g));
        d[i + 2] = Math.max(0, Math.min(255, b));
      }

      ctx.putImageData(imageData, 0, 0);
      resolve(canvas.toDataURL("image/jpeg", 0.9));
    };
    img.src = dataUrl;
  });
}

const FILTER_LABELS = {
  color: "Color",
  photo: "Photo",
  grayscale: "Gray",
  bw: "B&W",
  document: "Doc",
};

async function getFilteredSrc(item) {
  // Prefer manual crop if set, else auto-cropped, else original
  let base = item.manualCrop || item.cropped || item.original;
  const pageFilter = item.filter || "color";
  if (pageFilter === "color") return base;
  if (item.filterCache && item.filterCache[pageFilter + (item.manualCrop ? "_m" : "")]) {
    return item.filterCache[pageFilter + (item.manualCrop ? "_m" : "")];
  }
  const src = await applyScanFilter(base, pageFilter);
  if (!item.filterCache) item.filterCache = {};
  item.filterCache[pageFilter + (item.manualCrop ? "_m" : "")] = src;
  return src;
}

// Render previews — tap image to open full-screen editor
async function renderScanPreviews() {
  scanPreviews.innerHTML = "";

  for (let index = 0; index < scannedImages.length; index++) {
    const item = scannedImages[index];
    if (!item.filter) item.filter = currentScanFilter || "color";

    const div = document.createElement("div");
    div.className = "scan-preview-item expanded";

    const src = await getFilteredSrc(item);
    const pageFilter = item.filter || "color";

    div.innerHTML = `
      <div class="scan-preview-top" data-edit-index="${index}">
        <img src="${src}" alt="Page ${index + 1}">
        <span class="page-num">Page ${index + 1} · ${FILTER_LABELS[pageFilter] || pageFilter}</span>
        <button class="remove-page" data-index="${index}">×</button>
      </div>
      <div class="page-order-row">
        <button type="button" class="page-order-btn" data-action="up" data-index="${index}">↑</button>
        <button type="button" class="page-order-btn edit-page-btn" data-index="${index}">Edit · Crop · Filter</button>
        <button type="button" class="page-order-btn" data-action="down" data-index="${index}">↓</button>
      </div>
    `;
        scanPreviews.appendChild(div);
  }

  const addMore = document.getElementById("addMorePages");
  if (addMore) {
    addMore.style.display = scannedImages.length > 0 ? "block" : "none";
  }
}

// Event delegation for scan previews (works even after re-render)
if (scanPreviews && !scanPreviews._formixBound) {
  scanPreviews._formixBound = true;
  scanPreviews.addEventListener("click", (e) => {
    const target = e.target;

    // Delete page
    const removeBtn = target.closest(".remove-page");
    if (removeBtn) {
      e.preventDefault();
      e.stopPropagation();
      const idx = parseInt(removeBtn.dataset.index, 10);
      if (!isNaN(idx)) {
        scannedImages.splice(idx, 1);
        renderScanPreviews();
        if (scannedImages.length === 0) scanOptions.style.display = "none";
      }
      return;
    }

    // Reorder
    const orderBtn = target.closest(".page-order-btn[data-action]");
    if (orderBtn) {
      e.preventDefault();
      e.stopPropagation();
      const idx = parseInt(orderBtn.dataset.index, 10);
      const action = orderBtn.dataset.action;
      if (action === "up" && idx > 0) {
        const t = scannedImages[idx - 1];
        scannedImages[idx - 1] = scannedImages[idx];
        scannedImages[idx] = t;
        renderScanPreviews();
      } else if (action === "down" && idx < scannedImages.length - 1) {
        const t = scannedImages[idx + 1];
        scannedImages[idx + 1] = scannedImages[idx];
        scannedImages[idx] = t;
        renderScanPreviews();
      }
      return;
    }

    // Open full-screen editor (Edit button or image area)
    const editBtn = target.closest(".edit-page-btn");
    const editArea = target.closest("[data-edit-index]");
    if (editBtn || editArea) {
      e.preventDefault();
      e.stopPropagation();
      const idx = parseInt(
        (editBtn && editBtn.dataset.index) ||
          (editArea && editArea.dataset.editIndex),
        10
      );
      if (!isNaN(idx)) {
        openPageEditor(idx);
      }
    }
  });
}

// Global filter buttons → apply to ALL pages
document.querySelectorAll("#filterRow .filter-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#filterRow .filter-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentScanFilter = btn.dataset.filter || "color";
    scannedImages.forEach((item) => {
      item.filter = currentScanFilter;
      item.filterCache = {};
    });
    renderScanPreviews();
  });
});

if (autoCropCheck) {
  autoCropCheck.addEventListener("change", () => {
    renderScanPreviews();
  });
}

// ========== FULL-SCREEN PAGE EDITOR (crop + filter + reorder) ==========
let editorIndex = -1;
// 4-corner crop (normalized 0-1)
let cropState = {
  tl: { x: 0.05, y: 0.05 },
  tr: { x: 0.95, y: 0.05 },
  br: { x: 0.95, y: 0.95 },
  bl: { x: 0.05, y: 0.95 }
};
let dragHandle = null;
let dragStart = null;

const pageEditor = document.getElementById("pageEditor");
const cropImage = document.getElementById("cropImage");
const cropBox = document.getElementById("cropBox");
const cropWrap = document.getElementById("cropWrap");

function openPageEditor(index) {
  try {
    if (typeof index !== "number" || isNaN(index) || index < 0 || index >= scannedImages.length) {
      console.warn("openPageEditor invalid index", index);
      return;
    }
    const editorEl = document.getElementById("pageEditor");
    const imgEl = document.getElementById("cropImage");
    if (!editorEl || !imgEl) {
      alert("Page editor not found. Please re-upload the latest app files to Netlify.");
      return;
    }

    editorIndex = index;
    const item = scannedImages[index];
    const titleEl = document.getElementById("pageEditorTitle");
    if (titleEl) titleEl.textContent = `Page ${index + 1} of ${scannedImages.length}`;

    const src = item.original;

    imgEl.onload = () => {
      if (item.cropNorm && item.cropNorm.tl) {
        cropState = {
          tl: { ...item.cropNorm.tl },
          tr: { ...item.cropNorm.tr },
          br: { ...item.cropNorm.br },
          bl: { ...item.cropNorm.bl }
        };
      } else {
        cropState = {
          tl: { x: 0.05, y: 0.05 },
          tr: { x: 0.95, y: 0.05 },
          br: { x: 0.95, y: 0.95 },
          bl: { x: 0.05, y: 0.95 }
        };
      }
      setTimeout(layoutCropBox, 50);
    };

    // Force reload even if same src
    imgEl.src = "";
    imgEl.src = src;

    document.querySelectorAll("#editorFilterRow .filter-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.filter === (item.filter || "color"));
    });

    editorEl.style.display = "flex";
    editorEl.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  } catch (err) {
    console.error("openPageEditor error", err);
    alert("Could not open editor: " + (err.message || String(err)));
  }
}

function closePageEditor() {
  const editorEl = document.getElementById("pageEditor");
  if (editorEl) {
    editorEl.style.display = "none";
    editorEl.setAttribute("aria-hidden", "true");
  }
  document.body.style.overflow = "";
  editorIndex = -1;
  dragHandle = null;
}

function layoutCropBox() {
  if (!cropImage || !cropImage.naturalWidth) return;
  const wrapRect = cropWrap.getBoundingClientRect();
  const imgRect = cropImage.getBoundingClientRect();

  const offsetX = imgRect.left - wrapRect.left;
  const offsetY = imgRect.top - wrapRect.top;
  const w = imgRect.width;
  const h = imgRect.height;

  // Helper to convert normalized point → pixel position inside the wrap
  function toPx(pt) {
    return {
      x: offsetX + pt.x * w,
      y: offsetY + pt.y * h
    };
  }

  const tl = toPx(cropState.tl);
  const tr = toPx(cropState.tr);
  const br = toPx(cropState.br);
  const bl = toPx(cropState.bl);

  // Position the 4 corner handles
  const handles = {
    tl: cropBox.querySelector('.crop-handle.tl'),
    tr: cropBox.querySelector('.crop-handle.tr'),
    br: cropBox.querySelector('.crop-handle.br'),
    bl: cropBox.querySelector('.crop-handle.bl')
  };

  if (handles.tl) {
  handles.tl.style.left = (tl.x - offsetX - 18) + "px";
  handles.tl.style.top = (tl.y - offsetY - 18) + "px";
}
if (handles.tr) {
  handles.tr.style.left = (tr.x - offsetX - 18) + "px";
  handles.tr.style.top = (tr.y - offsetY - 18) + "px";
}
if (handles.br) {
  handles.br.style.left = (br.x - offsetX - 18) + "px";
  handles.br.style.top = (br.y - offsetY - 18) + "px";
}
if (handles.bl) {
  handles.bl.style.left = (bl.x - offsetX - 18) + "px";
  handles.bl.style.top = (bl.y - offsetY - 18) + "px";
}

  // For now keep the cropBox itself covering the whole image area
  // (we'll improve the visual outline in the next step)
  cropBox.style.left = offsetX + "px";
  cropBox.style.top = offsetY + "px";
  cropBox.style.width = w + "px";
  cropBox.style.height = h + "px";
  cropBox.style.border = "none";
  cropBox.style.boxShadow = "none";
    // Draw the 4-corner outline
  const polygon = document.getElementById("cropPolygon");
  if (polygon) {
    const points = [
  `${tl.x - offsetX},${tl.y - offsetY}`,
  `${tr.x - offsetX},${tr.y - offsetY}`,
  `${br.x - offsetX},${br.y - offsetY}`,
  `${bl.x - offsetX},${bl.y - offsetY}`
].join(" ");
    polygon.setAttribute("points", points);
  }
}

function applyManualCropFromState() {
  const item = scannedImages[editorIndex];
  if (!item || !cropState || !cropState.tl) return Promise.resolve();

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const w = img.width;
        const h = img.height;

        const points = [
          cropState.tl,
          cropState.tr,
          cropState.br,
          cropState.bl
        ];

        // Convert to pixels
        const px = points.map(p => ({
          x: Math.max(0, Math.min(w, p.x * w)),
          y: Math.max(0, Math.min(h, p.y * h))
        }));

        const minX = Math.min(px[0].x, px[1].x, px[2].x, px[3].x);
        const maxX = Math.max(px[0].x, px[1].x, px[2].x, px[3].x);
        const minY = Math.min(px[0].y, px[1].y, px[2].y, px[3].y);
        const maxY = Math.max(px[0].y, px[1].y, px[2].y, px[3].y);

        const bw = Math.max(10, maxX - minX);
        const bh = Math.max(10, maxY - minY);

        const canvas = document.createElement("canvas");
        canvas.width = Math.round(bw);
        canvas.height = Math.round(bh);
        const ctx = canvas.getContext("2d");

        ctx.drawImage(img, minX, minY, bw, bh, 0, 0, canvas.width, canvas.height);

        item.manualCrop = canvas.toDataURL("image/jpeg", 0.9);
        item.cropNorm = {
          tl: { ...cropState.tl },
          tr: { ...cropState.tr },
          br: { ...cropState.br },
          bl: { ...cropState.bl }
        };
        item.filterCache = {};
      } catch (err) {
        console.error("Crop failed", err);
      }
      resolve();
    };
    img.onerror = () => resolve();
    img.src = item.original;
  });
}
      

// Touch / mouse crop handles
function getPoint(e) {
  if (e.touches && e.touches[0]) {
    return { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }
  return { x: e.clientX, y: e.clientY };
}

function onCropStart(e) {
  const handle = e.target.dataset?.handle;
  if (!handle || !["tl", "tr", "br", "bl"].includes(handle)) return;
  e.preventDefault();
  dragHandle = handle;
  dragStart = getPoint(e);
  dragStart.crop = JSON.parse(JSON.stringify(cropState));
}

function onCropMove(e) {
  if (!dragHandle || !dragStart) return;
  e.preventDefault();
  const p = getPoint(e);
  const imgRect = cropImage.getBoundingClientRect();

  let nx = (p.x - imgRect.left) / imgRect.width;
  let ny = (p.y - imgRect.top) / imgRect.height;

  nx = Math.max(0, Math.min(1, nx));
  ny = Math.max(0, Math.min(1, ny));

  cropState[dragHandle] = { x: nx, y: ny };
  layoutCropBox();
}

function onCropEnd() {
  dragHandle = null;
  dragStart = null;
}

function onCropEnd() {
  dragHandle = null;
  dragStart = null;
}

if (cropBox) {
  cropBox.addEventListener("mousedown", onCropStart);
  cropBox.addEventListener("touchstart", onCropStart, { passive: false });
  document.querySelectorAll(".crop-handle").forEach((h) => {
    h.addEventListener("mousedown", onCropStart);
    h.addEventListener("touchstart", onCropStart, { passive: false });
  });
}
window.addEventListener("mousemove", onCropMove);
window.addEventListener("touchmove", onCropMove, { passive: false });
window.addEventListener("mouseup", onCropEnd);
window.addEventListener("touchend", onCropEnd);
window.addEventListener("resize", () => {
  if (editorIndex >= 0) layoutCropBox();
});

document.getElementById("pageEditorCancel")?.addEventListener("click", closePageEditor);

document.getElementById("pageEditorDone")?.addEventListener("click", async () => {
  if (editorIndex < 0) return;
  await applyManualCropFromState();
  closePageEditor();
  renderScanPreviews();
});

document.getElementById("pageResetCrop")?.addEventListener("click", () => {
  cropState = { x: 0, y: 0, w: 1, h: 1 };
  layoutCropBox();
  if (scannedImages[editorIndex]) {
    scannedImages[editorIndex].manualCrop = null;
    scannedImages[editorIndex].cropNorm = null;
    scannedImages[editorIndex].filterCache = {};
  }
});

document.getElementById("pageDeleteBtn")?.addEventListener("click", () => {
  if (editorIndex < 0) return;
  if (!confirm("Delete this page?")) return;
  scannedImages.splice(editorIndex, 1);
  closePageEditor();
  renderScanPreviews();
  if (scannedImages.length === 0) scanOptions.style.display = "none";
});

document.getElementById("pageMoveUp")?.addEventListener("click", async () => {
  if (editorIndex <= 0) return;
  await applyManualCropFromState();
  const i = editorIndex;
  const t = scannedImages[i - 1];
  scannedImages[i - 1] = scannedImages[i];
  scannedImages[i] = t;
  openPageEditor(i - 1);
});

document.getElementById("pageMoveDown")?.addEventListener("click", async () => {
  if (editorIndex < 0 || editorIndex >= scannedImages.length - 1) return;
  await applyManualCropFromState();
  const i = editorIndex;
  const t = scannedImages[i + 1];
  scannedImages[i + 1] = scannedImages[i];
  scannedImages[i] = t;
  openPageEditor(i + 1);
});

document.querySelectorAll("#editorFilterRow .filter-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (editorIndex < 0) return;
    document.querySelectorAll("#editorFilterRow .filter-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    scannedImages[editorIndex].filter = btn.dataset.filter || "color";
    scannedImages[editorIndex].filterCache = {};
  });
});

// Page size formats for jsPDF (mm)
const PAGE_SIZES = {
  small:  { format: "a5", orientation: "portrait" },      // smaller page
  medium: { format: "letter", orientation: "portrait" },  // standard
  large:  { format: "legal", orientation: "portrait" },   // taller page
  fit: null, // custom size based on first image
};

// Create PDF from scans
createScanPdfBtn.addEventListener("click", async () => {
  if (isAnonymousTrialExpired()) {
  alert("Your free 3-day trial has ended.\n\nPlease sign in with Google to continue using Formix PDF.");
  showScreen("accountScreen");
  return;
}
  if (scannedImages.length === 0) return;

  createScanPdfBtn.disabled = true;
  createScanPdfBtn.textContent = "Creating PDF…";

  try {
    const sizeKey = document.getElementById("scanPageSize")?.value || "medium";
    const margin = 10;

    // Prepare filtered images first (uses manual crop / auto-crop + filter)
    const pagesData = [];
    for (const item of scannedImages) {
      const imgData = await getFilteredSrc(item);
      pagesData.push(imgData);
    }

    let doc;
    if (sizeKey === "fit") {
      // Fit first page size to image aspect (use points: 1px ≈ 0.75pt at 96dpi, scale reasonably)
      const firstProps = new jsPDF().getImageProperties(pagesData[0]);
      const maxW = 210; // mm max width ~ A4 width
      const ratio = firstProps.height / firstProps.width;
      let wMm = maxW;
      let hMm = maxW * ratio;
      if (hMm > 297) {
        hMm = 297;
        wMm = 297 / ratio;
      }
      doc = new jsPDF({ unit: "mm", format: [wMm, hMm], orientation: wMm > hMm ? "landscape" : "portrait" });
    } else {
      const cfg = PAGE_SIZES[sizeKey] || PAGE_SIZES.letter;
      doc = new jsPDF({ format: cfg.format, orientation: cfg.orientation });
    }

    for (let index = 0; index < pagesData.length; index++) {
      if (index > 0) {
        if (sizeKey === "fit") {
          const props = doc.getImageProperties(pagesData[index]);
          const maxW = 210;
          const ratio = props.height / props.width;
          let wMm = maxW;
          let hMm = maxW * ratio;
          if (hMm > 297) {
            hMm = 297;
            wMm = 297 / ratio;
          }
          doc.addPage([wMm, hMm], wMm > hMm ? "landscape" : "portrait");
        } else {
          doc.addPage();
        }
      }

      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const imgData = pagesData[index];
      const imgProps = doc.getImageProperties(imgData);
      const imgWidth = pageWidth - margin * 2;
      const imgHeight = (imgProps.height * imgWidth) / imgProps.width;

      let finalHeight = imgHeight;
      let finalWidth = imgWidth;

      if (imgHeight > pageHeight - margin * 2) {
        finalHeight = pageHeight - margin * 2;
        finalWidth = (imgProps.width * finalHeight) / imgProps.height;
      }

      const x = (pageWidth - finalWidth) / 2;
      const y = margin;
      doc.addImage(imgData, "JPEG", x, y, finalWidth, finalHeight);
    }

    currentTemplate = "scan";
    const pages = scannedImages.length;
    const sizeLabel = sizeKey.toUpperCase();

    // Custom file name (optional)
    let customName = (document.getElementById("scanFileName")?.value || "").trim();
    // Sanitize: remove illegal filename characters
    customName = customName.replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, "-");
    if (customName.toLowerCase().endsWith(".pdf")) {
      customName = customName.slice(0, -4);
    }

    const name = customName
      ? `${customName}.pdf`
      : `Scan-${pages}p-${sizeLabel}-${new Date().toISOString().slice(0, 10)}.pdf`;

    const title = customName
      ? customName
      : `Scan (${pages} page${pages > 1 ? "s" : ""}) · ${sizeLabel}`;

    showSuccessPreview(doc, name, title);
  } catch (err) {
    console.error(err);
    alert("Could not create scan PDF: " + (err.message || String(err)));
  } finally {
    createScanPdfBtn.disabled = false;
    createScanPdfBtn.textContent = "Create PDF from Scans";
  }
});

// Clear scans
clearScansBtn.addEventListener("click", () => {
  scannedImages = [];
  scanPreviews.innerHTML = "";
  const nameInput = document.getElementById("scanFileName");
  if (nameInput) nameInput.value = "";
  scanOptions.style.display = "none";
});

// ========== LINE ITEMS ==========

const addItemBtn = document.getElementById("addItemBtn");
const lineItemsContainer = document.getElementById("lineItems");

function addLineItem() {
  const div = document.createElement("div");
  div.className = "line-item";
  div.innerHTML = `
    <input type="text" class="item-desc" placeholder="Description of work / product">
    <div class="line-item-row">
      <input type="number" class="item-qty" placeholder="Qty" value="1" min="1" step="1">
      <input type="number" class="item-price" placeholder="Price" step="0.01" min="0">
    </div>
  `;
  lineItemsContainer.appendChild(div);
}

if (addItemBtn) {
  addItemBtn.addEventListener("click", addLineItem);
}

// Set default dates + apply saved preferences
function setDefaultDates() {
  const today = new Date().toISOString().split("T")[0];
  const dateInput = document.getElementById("invoiceDate");
  const dueInput = document.getElementById("dueDate");
  if (dateInput && !dateInput.value) dateInput.value = today;
  if (dueInput && !dueInput.value) {
    const due = new Date();
    due.setDate(due.getDate() + 15);
    dueInput.value = due.toISOString().split("T")[0];
  }
  // Auto invoice number
  const invNum = document.getElementById("invoiceNumber");
  if (invNum && !invNum.value) {
    invNum.value = "INV-" + Math.floor(1000 + Math.random() * 9000);
  }
  // Prefill from Account preferences
  try {
    const prefs = JSON.parse(localStorage.getItem("formix_prefs") || "{}");
    const cn = document.getElementById("companyName");
    const cc = document.getElementById("companyContact");
    if (cn && !cn.value && prefs.company) cn.value = prefs.company;
    if (cc && !cc.value && prefs.contact) cc.value = prefs.contact;
  } catch {}
}

// ========== PROFESSIONAL INVOICE PDF ==========

function generateInvoicePDF() {
  const company = document.getElementById("companyName").value.trim() || "Your Company";
  const companyContact = document.getElementById("companyContact").value.trim();
  const companyAddress = document.getElementById("companyAddress").value.trim();
  const client = document.getElementById("clientName").value.trim() || "Client";
  const clientEmail = document.getElementById("clientEmail")?.value.trim() || "";
  const clientAddress = document.getElementById("clientAddress")?.value.trim() || "";
  const invoiceNumber = document.getElementById("invoiceNumber").value.trim() || "INV-0001";
  const invoiceDate = document.getElementById("invoiceDate").value || new Date().toISOString().split("T")[0];
  const dueDate = document.getElementById("dueDate").value || "";
  const notes = document.getElementById("description").value.trim();
  const taxRate = parseFloat(document.getElementById("taxRate").value) || 0;
  const discount = parseFloat(document.getElementById("discount").value) || 0;

  // Collect line items
  const items = [];
  document.querySelectorAll(".line-item").forEach(row => {
    const desc = row.querySelector(".item-desc").value.trim();
    const qty = parseFloat(row.querySelector(".item-qty").value) || 0;
    const price = parseFloat(row.querySelector(".item-price").value) || 0;
    if (desc || price > 0) {
      items.push({ desc: desc || "Item", qty, price, total: qty * price });
    }
  });

  const subtotal = items.reduce((sum, i) => sum + i.total, 0);
  const taxAmount = subtotal * (taxRate / 100);
  const total = Math.max(0, subtotal + taxAmount - discount);

  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 20;
  let y = 22;

  // Header bar
  doc.setFillColor(17, 17, 17);
  doc.rect(0, 0, pageWidth, 48, "F");

  // Logo (if uploaded)
  let titleX = margin;
  if (companyLogoDataUrl) {
    try {
      const logoFormat = companyLogoDataUrl.indexOf("image/png") !== -1 ? "PNG" : "JPEG";
      doc.addImage(companyLogoDataUrl, logoFormat, margin, 10, 22, 22);
      titleX = margin + 28;
    } catch (err) {
      console.warn("Could not add logo", err);
    }
  }

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(20);
  doc.setFont("helvetica", "bold");
  doc.text("INVOICE", titleX, 24);

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(invoiceNumber, pageWidth - margin, 18, { align: "right" });
  doc.setFontSize(9);
  doc.text("Date: " + formatDate(invoiceDate), pageWidth - margin, 26, { align: "right" });
  if (dueDate) {
    doc.text("Due: " + formatDate(dueDate), pageWidth - margin, 34, { align: "right" });
  }

  y = 60;
  doc.setTextColor(0);

  // From / To columns
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.setFont("helvetica", "bold");
  doc.text("FROM", margin, y);
  doc.text("BILL TO", pageWidth / 2 + 5, y);

  y += 7;
  doc.setTextColor(0);
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text(company, margin, y);
  doc.text(client, pageWidth / 2 + 5, y);

  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(60);

  let leftY = y;
  let rightY = y;

  if (companyContact) {
    doc.text(companyContact, margin, leftY);
    leftY += 5;
  }
  if (clientEmail) {
    doc.text(clientEmail, pageWidth / 2 + 5, rightY);
    rightY += 5;
  }

  if (companyAddress) {
    const addrLines = doc.splitTextToSize(companyAddress, 80);
    doc.text(addrLines, margin, leftY);
    leftY += addrLines.length * 5;
  }
  if (clientAddress) {
    const clientAddrLines = doc.splitTextToSize(clientAddress, 80);
    doc.text(clientAddrLines, pageWidth / 2 + 5, rightY);
    rightY += clientAddrLines.length * 5;
  }

  y = Math.max(leftY, rightY, 95);

  // Table header
  doc.setFillColor(245, 245, 245);
  doc.rect(margin, y - 5, pageWidth - margin * 2, 10, "F");

  doc.setTextColor(80);
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.text("DESCRIPTION", margin + 2, y + 2);
  doc.text("QTY", 125, y + 2);
  doc.text("PRICE", 145, y + 2);
  doc.text("AMOUNT", pageWidth - margin - 2, y + 2, { align: "right" });

  y += 12;
  doc.setFont("helvetica", "normal");
  doc.setTextColor(0);
  doc.setFontSize(10);

  if (items.length === 0) {
    doc.setTextColor(150);
    doc.text("No items added", margin + 2, y);
    y += 10;
  } else {
    items.forEach((item, idx) => {
      if (y > 250) {
        doc.addPage();
        y = 30;
      }
      const descLines = doc.splitTextToSize(item.desc, 95);
      doc.text(descLines, margin + 2, y);
      doc.text(String(item.qty), 125, y);
      doc.text("$" + item.price.toFixed(2), 145, y);
      doc.text("$" + item.total.toFixed(2), pageWidth - margin - 2, y, { align: "right" });
      y += Math.max(8, descLines.length * 5 + 3);

      // light separator
      doc.setDrawColor(230);
      doc.line(margin, y - 2, pageWidth - margin, y - 2);
    });
  }

  y += 8;

  // Totals
  const totalsX = 130;
  doc.setFontSize(10);
  doc.setTextColor(60);
  doc.text("Subtotal", totalsX, y);
  doc.text("$" + subtotal.toFixed(2), pageWidth - margin, y, { align: "right" });
  y += 7;

  if (taxRate > 0) {
    doc.text(`Tax (${taxRate}%)`, totalsX, y);
    doc.text("$" + taxAmount.toFixed(2), pageWidth - margin, y, { align: "right" });
    y += 7;
  }

  if (discount > 0) {
    doc.text("Discount", totalsX, y);
    doc.text("-$" + discount.toFixed(2), pageWidth - margin, y, { align: "right" });
    y += 7;
  }

  // Total line
  doc.setDrawColor(17, 17, 17);
  doc.setLineWidth(0.6);
  doc.line(totalsX - 5, y - 2, pageWidth - margin, y - 2);

  y += 6;
  doc.setFontSize(13);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(0);
  doc.text("TOTAL", totalsX, y);
  doc.text("$" + total.toFixed(2), pageWidth - margin, y, { align: "right" });

  // Notes
  if (notes) {
    y += 18;
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(120);
    doc.text("NOTES / TERMS", margin, y);
    y += 6;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(60);
    const noteLines = doc.splitTextToSize(notes, pageWidth - margin * 2);
    doc.text(noteLines, margin, y);
  }

  // Footer
  doc.setFontSize(8);
  doc.setTextColor(160);
  doc.text("Generated with Formix PDF", margin, 285);
  doc.text(company, pageWidth - margin, 285, { align: "right" });

  return doc;
}

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

// ========== CUSTOMERS ==========
function getCustomers() {
  try {
    return JSON.parse(localStorage.getItem(CUSTOMERS_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveCustomers(list) {
  localStorage.setItem(CUSTOMERS_KEY, JSON.stringify(list));
}

function renderCustomerSelect() {
  if (!customerSelect) return;
  const list = getCustomers();
  const currentVal = customerSelect.value;
  customerSelect.innerHTML = '<option value="">— Select saved customer —</option>';
  list.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c.id;
    const extra = c.email || c.contact || "";
    opt.textContent = c.name + (extra ? " · " + extra : "");
    customerSelect.appendChild(opt);
  });
  if (currentVal) customerSelect.value = currentVal;
}

function addOrUpdateCustomer(name, email, address) {
  if (!name) return;
  const list = getCustomers();
  const existing = list.find(
    (c) => c.name.toLowerCase() === name.toLowerCase()
  );
  if (existing) {
    existing.email = email || existing.email || "";
    existing.address = address || existing.address || "";
    // keep old contact for backward compatibility
    existing.contact = email || existing.contact || "";
    existing.updated = new Date().toISOString();
  } else {
    list.unshift({
      id: "c_" + Date.now(),
      name,
      email: email || "",
      address: address || "",
      contact: email || "", // backward compat
      created: new Date().toISOString(),
    });
  }
  // Keep max 50
  if (list.length > 50) list.length = 50;
  saveCustomers(list);
  renderCustomerSelect();
}

if (customerSelect) {
  customerSelect.addEventListener("change", () => {
    const id = customerSelect.value;
    if (!id) return;
    const c = getCustomers().find((x) => x.id === id);
    if (c) {
      document.getElementById("clientName").value = c.name || "";
      document.getElementById("clientEmail").value = c.email || c.contact || "";
      document.getElementById("clientAddress").value = c.address || "";
    }
  });
}

if (manageCustomersBtn) {
  manageCustomersBtn.addEventListener("click", () => {
    const list = getCustomers();
    if (list.length === 0) {
      alert("No saved customers yet.\n\nFill client name + check “Save this customer” when generating an invoice.");
      return;
    }
    const names = list.map((c, i) => `${i + 1}. ${c.name}`).join("\n");
    const answer = prompt(
      "Saved customers:\n\n" + names + "\n\nType a number to delete that customer, or Cancel to keep all:"
    );
    if (!answer) return;
    const idx = parseInt(answer, 10) - 1;
    if (idx >= 0 && idx < list.length) {
      if (confirm(`Delete "${list[idx].name}"?`)) {
        list.splice(idx, 1);
        saveCustomers(list);
        renderCustomerSelect();
      }
    }
  });
}

// ========== HISTORY ==========
function getHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveHistory(list) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
}

function addToHistory(entry) {
  const list = getHistory();
  list.unshift(entry);
  if (list.length > MAX_HISTORY) list.length = MAX_HISTORY;
  saveHistory(list);
}

function renderHistory() {
  const listEl = document.getElementById("historyList");
  const clearBtn = document.getElementById("clearHistoryBtn");
  if (!listEl) return;
  const list = getHistory();
  if (list.length === 0) {
    listEl.innerHTML = '<div class="history-empty">No documents yet. Scan or create an invoice to see them here.</div>';
    if (clearBtn) clearBtn.style.display = "none";
    return;
  }
  if (clearBtn) clearBtn.style.display = "block";
    listEl.innerHTML = list
    .map(
      (item) => `
    <div class="history-item" data-id="${item.id}">
      <div class="history-info">
        <div class="history-title">${item.title || item.fileName}</div>
        <div class="history-meta">${item.type} · ${new Date(item.date).toLocaleString()}</div>
      </div>
      <div class="history-actions">
        ${item.type === "scan" && item.pages ? `<button class="btn-icon-sm history-edit" data-id="${item.id}" title="Edit pages">✎</button>` : `<button class="btn-icon-sm history-rename" data-id="${item.id}" title="Rename">✎</button>`}
        <button class="btn-icon-sm history-open" data-id="${item.id}" title="Open">↗</button>
        <button class="btn-icon-sm history-delete" data-id="${item.id}" title="Delete">×</button>
      </div>
    </div>`
    )
    .join("");

  listEl.querySelectorAll(".history-open").forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = getHistory().find((x) => x.id === btn.dataset.id);
      if (!item || !item.dataUrl) return;
      if (lastPdfBlobUrl && lastPdfBlobUrl.startsWith("blob:")) {
        URL.revokeObjectURL(lastPdfBlobUrl);
      }
      lastPdfDoc = null;
      lastPdfFileName = item.fileName || "document.pdf";
      setPdfFileNameInput(lastPdfFileName);
      if (pdfPreviewFrame) pdfPreviewFrame.src = item.dataUrl;
      document.getElementById("successMessage").textContent = item.title || "Saved document";
      showScreen("successScreen");
      lastPdfBlobUrl = item.dataUrl;
    });
  });
  listEl.querySelectorAll(".history-edit").forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = getHistory().find((x) => x.id === btn.dataset.id);
      if (!item || !item.pages || !item.pages.length) {
        alert("This scan has no editable pages saved.");
        return;
      }

      scannedImages = item.pages.map((p) => ({
  original: p.image || p.original,
  manualCrop: null,
  cropped: null,
  filter: p.filter || "color",
  filterCache: {}
}));

      currentTemplate = "scan";
      renderScanPreviews();
      if (scanOptions) scanOptions.style.display = "flex";
      showScreen("scanScreen");
    });
  });
  listEl.querySelectorAll(".history-rename").forEach((btn) => {
    btn.addEventListener("click", () => {
      const list = getHistory();
      const item = list.find((x) => x.id === btn.dataset.id);
      if (!item) return;
      let current = (item.fileName || item.title || "document").replace(/\.pdf$/i, "");
      const answer = prompt("Rename file:", current);
      if (answer === null) return;
      const clean = sanitizeFileName(answer);
      if (!clean) {
        alert("Please enter a valid name.");
        return;
      }
      item.fileName = clean + ".pdf";
      item.title = clean;
      saveHistory(list);
      renderHistory();
    });
  });

  listEl.querySelectorAll(".history-delete").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!confirm("Remove this document from history?")) return;
      const list = getHistory().filter((x) => x.id !== btn.dataset.id);
      saveHistory(list);
      renderHistory();
    });
  });
}

document.getElementById("clearHistoryBtn")?.addEventListener("click", () => {
  if (confirm("Clear all history? This cannot be undone.")) {
    saveHistory([]);
    renderHistory();
  }
});

// ========== SUCCESS / PREVIEW ==========
function sanitizeFileName(name) {
  let n = (name || "").trim();
  n = n.replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, "-");
  if (n.toLowerCase().endsWith(".pdf")) n = n.slice(0, -4);
  return n;
}

function getCurrentPdfFileName() {
  const input = document.getElementById("pdfFileNameInput");
  const custom = sanitizeFileName(input?.value || "");
  if (custom) return custom + ".pdf";
  return lastPdfFileName || "document.pdf";
}

function setPdfFileNameInput(fileName) {
  const input = document.getElementById("pdfFileNameInput");
  if (!input) return;
  let n = fileName || "";
  if (n.toLowerCase().endsWith(".pdf")) n = n.slice(0, -4);
  input.value = n;
}

function showSuccessPreview(doc, fileName, title) {
  lastPdfDoc = doc;
  lastPdfFileName = fileName || `${currentTemplate}-${Date.now()}.pdf`;
  setPdfFileNameInput(lastPdfFileName);

  const msg = document.getElementById("successMessage");
  if (msg) msg.textContent = title || "Preview your document, then download or share";

  // Show success screen first (feels snappier, less glitchy)
  showScreen("successScreen");

  // Revoke previous blob URL
  if (lastPdfBlobUrl && lastPdfBlobUrl.startsWith("blob:")) {
    try {
      URL.revokeObjectURL(lastPdfBlobUrl);
    } catch (_) {}
  }
  lastPdfBlobUrl = null;

  if (pdfPreviewFrame) {
    pdfPreviewFrame.src = "about:blank";
  }

  // Load preview after paint
  setTimeout(() => {
    try {
      lastPdfBlobUrl = doc.output("bloburl");
      if (pdfPreviewFrame) {
        pdfPreviewFrame.src = lastPdfBlobUrl;
      }
    } catch (err) {
      console.warn("Preview failed", err);
      if (pdfPreviewFrame) pdfPreviewFrame.src = "";
    }
  }, 30);

    // Auto-save scans to history in background (can be heavy)
  if (currentTemplate === "scan") {
    setTimeout(() => {
      try {
        const finalName = getCurrentPdfFileName();
        lastPdfFileName = finalName;
        const dataUrl = doc.output("datauristring");
        if (dataUrl && dataUrl.length > 4_500_000) {
          console.warn("Scan too large for auto-history");
          return;
        }

        const baseEntry = {
          id: "h_" + Date.now(),
          type: "scan",
          title: title || finalName.replace(/\.pdf$/i, ""),
          fileName: finalName,
          date: new Date().toISOString(),
          dataUrl
        };

        // Try with pages first (for re-edit)
        try {
          addToHistory({
            ...baseEntry,
                        pages: scannedImages.map((img) => ({
              image: img.manualCrop || img.cropped || img.original,
              filter: img.filter || "color"
            }))
          });
        } catch (e) {
          // Fallback: save without pages
          console.warn("Could not save pages, saving PDF only", e);
          addToHistory(baseEntry);
        }
      } catch (e) {
        console.warn("Could not auto-save scan to history", e);
      }
    }, 100);
  }

// Form submit
let isGeneratingPdf = false;

pdfForm.addEventListener("submit", (e) => {
  e.preventDefault();
  if (isAnonymousTrialExpired()) {
  e.preventDefault();
  alert("Your free 3-day trial has ended.\n\nPlease sign in with Google to continue using Formix PDF.");
  showScreen("accountScreen");
  return;
}
  if (isGeneratingPdf) return;

  const submitBtn = pdfForm.querySelector('button[type="submit"]');
  try {
    isGeneratingPdf = true;
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Creating…";
    }

    setDefaultDates();

    // Optionally save customer
    if (saveCustomerCheck && saveCustomerCheck.checked) {
      const name = document.getElementById("clientName")?.value.trim();
      const email = document.getElementById("clientEmail")?.value.trim() || "";
      const address = document.getElementById("clientAddress")?.value.trim() || "";
      if (name) {
        addOrUpdateCustomer(name, email, address);
        saveCustomerCheck.checked = false;
      }
    }

    const doc = generateInvoicePDF();
    if (!doc) {
      alert("Could not create PDF. Please try again.");
      return;
    }
    const invNum = document.getElementById("invoiceNumber")?.value.trim() || "INV";
    const client = document.getElementById("clientName")?.value.trim() || "Client";
    const safeClient = client.replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, "_").slice(0, 20);
    const name = `${invNum}-${safeClient || "Client"}.pdf`;
    const title = `Invoice ${invNum} · ${client}`;

    // Defer heavy preview work so the button state updates smoothly
    requestAnimationFrame(() => {
      try {
        showSuccessPreview(doc, name, title);
      } catch (err2) {
        console.error("Preview error:", err2);
        alert("PDF created but preview failed. Try Download from History.");
      }
    });
  } catch (err) {
    console.error("Generate PDF error:", err);
    alert("Error creating PDF: " + (err.message || String(err)) + "\n\nPlease try again or clear the form.");
  } finally {
    isGeneratingPdf = false;
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Generate PDF";
    }
  }
});

// When opening form screen, set defaults + customers
document.querySelectorAll(".feature-card").forEach((card) => {
  card.addEventListener("click", () => {
    if (card.dataset.template !== "scan" && card.dataset.template !== "ai") {
      setTimeout(() => {
        setDefaultDates();
        renderCustomerSelect();
      }, 50);
    }
  });
});

// Download — mobile-friendly (avoids jsPDF.save glitches on iOS/PWA)
let isDownloading = false;

function triggerBlobDownload(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  // Cleanup after a short delay
  setTimeout(() => {
    try {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (_) {}
  }, 1500);
}

if (downloadBtn) {
  downloadBtn.addEventListener("click", async () => {
    if (isDownloading) return;
    isDownloading = true;
    const originalText = downloadBtn.textContent;
    downloadBtn.disabled = true;
    downloadBtn.textContent = "Downloading…";

    try {
      const fileName = getCurrentPdfFileName();
      lastPdfFileName = fileName;

      let blob = null;
      if (lastPdfDoc) {
        blob = lastPdfDoc.output("blob");
      } else if (lastPdfBlobUrl) {
        if (lastPdfBlobUrl.startsWith("blob:") || lastPdfBlobUrl.startsWith("data:")) {
          const res = await fetch(lastPdfBlobUrl);
          blob = await res.blob();
        }
      }

      if (!blob) {
        alert("Nothing to download yet. Create a PDF first.");
        return;
      }

      // Prefer Web Share on mobile if user is on iOS (download often flaky in PWAs)
      const isIOS =
        /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

      if (isIOS && navigator.share && navigator.canShare) {
        try {
          const file = new File([blob], fileName, { type: "application/pdf" });
          if (navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title: fileName });
            return;
          }
        } catch (shareErr) {
          if (shareErr && shareErr.name === "AbortError") return;
          // Fall through to anchor download
        }
      }

      triggerBlobDownload(blob, fileName);
    } catch (err) {
      console.error("Download error:", err);
      // Last resort: jsPDF save
      try {
        if (lastPdfDoc) lastPdfDoc.save(getCurrentPdfFileName());
        else alert("Download failed. Try Share instead.");
      } catch (e2) {
        alert("Download failed. Try the Share button.");
      }
    } finally {
      isDownloading = false;
      downloadBtn.disabled = false;
      downloadBtn.textContent = originalText || "Download PDF";
    }
  });
}

// Share (Web Share API with PDF file)
if (shareBtn) {
  shareBtn.addEventListener("click", async () => {
    try {
      const fileName = getCurrentPdfFileName();
      lastPdfFileName = fileName;
      let blob;
      if (lastPdfDoc) {
        blob = lastPdfDoc.output("blob");
      } else if (lastPdfBlobUrl && lastPdfBlobUrl.startsWith("data:")) {
        const res = await fetch(lastPdfBlobUrl);
        blob = await res.blob();
      } else {
        alert("Nothing to share yet.");
        return;
      }
      const file = new File([blob], fileName, {
        type: "application/pdf",
      });
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: "Formix PDF",
          text: fileName,
        });
      } else if (navigator.share) {
        await navigator.share({
          title: "Formix PDF",
          text: "Document created with Formix PDF",
        });
      } else {
        if (lastPdfDoc) lastPdfDoc.save(fileName);
        else alert("Sharing is not supported on this device. Use Download instead.");
      }
    } catch (err) {
      if (err.name !== "AbortError") {
        console.warn("Share failed", err);
        alert("Could not share. Try Download instead.");
      }
    }
  });
}

// Save to History (manual)
if (saveHistoryBtn) {
  saveHistoryBtn.addEventListener("click", () => {
    if (!lastPdfDoc && !(lastPdfBlobUrl && lastPdfBlobUrl.startsWith("data:"))) {
      alert("No PDF to save.");
      return;
    }
    try {
      let dataUrl;
      if (lastPdfDoc) {
        dataUrl = lastPdfDoc.output("datauristring");
      } else {
        dataUrl = lastPdfBlobUrl;
      }
      const fileName = getCurrentPdfFileName();
      lastPdfFileName = fileName;
      const title = fileName.replace(/\.pdf$/i, "");
      addToHistory({
        id: "h_" + Date.now(),
        type: currentTemplate || "pdf",
        title,
        fileName,
        date: new Date().toISOString(),
        dataUrl,
      });
      saveHistoryBtn.textContent = "Saved ✓";
      setTimeout(() => {
        saveHistoryBtn.textContent = "Save to History";
      }, 1500);
    } catch (e) {
      console.warn(e);
      alert("Could not save to history (file may be too large).");
    }
  });
}

// Create another
if (newBtn) {
  newBtn.addEventListener("click", () => {
    pdfForm.reset();
    lineItemsContainer.innerHTML = `
      <div class="line-item">
        <input type="text" class="item-desc" placeholder="Description of work / product">
        <div class="line-item-row">
          <input type="number" class="item-qty" placeholder="Qty" value="1" min="1" step="1">
          <input type="number" class="item-price" placeholder="Price" step="0.01" min="0">
        </div>
      </div>
    `;
    scannedImages = [];
    scanPreviews.innerHTML = "";
    scanOptions.style.display = "none";
    if (pdfPreviewFrame) pdfPreviewFrame.src = "";
    if (lastPdfBlobUrl && lastPdfBlobUrl.startsWith("blob:")) {
      URL.revokeObjectURL(lastPdfBlobUrl);
    }
    lastPdfBlobUrl = null;
    lastPdfDoc = null;
    showScreen("home");
  });
}

// ========== SUBSCRIPTION / ACCOUNT (REAL) ==========

async function loadUserAndSubscription() {
  if (!sb) {
    currentUser = null;
    realSubscription = null;
    updateAccountUI();
    return;
  }

  try {
    const { data: { session } } = await sb.auth.getSession();
    currentUser = session?.user || null;

    if (!currentUser) {
      realSubscription = null;
      updateAccountUI();
      return;
    }

    const { data, error } = await sb
  .from("subscriptions")
  .select("*")
  .eq("user_id", currentUser.id)
  .maybeSingle();

if (error) {
  console.log("Subscription fetch error:", error.message);
  realSubscription = null;
} else if (data) {
  realSubscription = data;
} else {
  // First time this user signs in → start 3-day free trial
  const { data: newRow, error: insertError } = await sb
    .from("subscriptions")
    .insert({
      user_id: currentUser.id,
      status: "trialing",
      trial_start: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .select()
    .single();

  if (insertError) {
    console.log("Trial start error:", insertError.message);
    realSubscription = null;
  } else {
    realSubscription = newRow;
  }
}

    updateAccountUI();
  } catch (err) {
    console.log("Auth error:", err);
    currentUser = null;
    realSubscription = null;
    updateAccountUI();
  }
}

function isSubscribed() {
  // Paid subscription
  if (realSubscription && (realSubscription.status === "active" || realSubscription.status === "trialing")) {
    return true;
  }

  // Free trial (3 days)
  if (realSubscription && realSubscription.trial_start) {
    const trialStart = new Date(realSubscription.trial_start);
    const now = new Date();
    const threeDays = 3 * 24 * 60 * 60 * 1000;
    if (now - trialStart < threeDays) {
      return true;
    }
  }

  return false;
}
function getFirstOpenDate() {
  const saved = localStorage.getItem(FIRST_OPEN_KEY);
  if (saved) return new Date(saved);
  const now = new Date();
  localStorage.setItem(FIRST_OPEN_KEY, now.toISOString());
  return now;
}

function isAnonymousTrialExpired() {
  if (currentUser) return false;
  const firstOpen = getFirstOpenDate();
  const threeDays = 3 * 24 * 60 * 60 * 1000;
  return (new Date() - firstOpen) > threeDays;
}
async function signInWithGoogle() {
  if (!sb) {
    alert("Authentication is not ready. Please refresh the page.");
    return;
  }

  const { error } = await sb.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: window.location.origin
    }
  });

  if (error) {
    alert("Login failed: " + error.message);
  }
}

async function signOut() {
  if (sb) {
    await sb.auth.signOut();
  }
  currentUser = null;
  realSubscription = null;
  updateAccountUI();
  showScreen("home");
}

function getSubscription() {
  return realSubscription;
}

function setSubscription() {
  // no longer used
}

function startTrial() {
  alert("Please sign in with Google first, then subscribe.");
}

function activateSubscription() {
  // no longer used
}

function goToStripeCheckout() {
  if (!currentUser) {
    alert("Please sign in with Google first.");
    signInWithGoogle();
    return;
  }

  if (!STRIPE_PAYMENT_LINK) {
    alert("Stripe Payment Link is not configured yet.");
    return;
  }

  const url = new URL(STRIPE_PAYMENT_LINK);
  url.searchParams.set("client_reference_id", currentUser.id);
  window.location.href = url.toString();
}

function goToCustomerPortal() {
  if (STRIPE_CUSTOMER_PORTAL_LINK) {
    window.location.href = STRIPE_CUSTOMER_PORTAL_LINK;
  } else {
    alert("Customer portal is not set up yet.");
  }
}

function handleCheckoutReturn() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("checkout") === "success") {
    alert("Payment received! Updating your subscription status...");
    window.history.replaceState({}, "", window.location.pathname);
    loadUserAndSubscription();
  }
}

function updateAccountUI() {
  const badge = document.getElementById("planBadge");
  const statusEl = document.getElementById("subStatus");
  const planEl = document.getElementById("subPlan");
  const billingEl = document.getElementById("subBilling");
  const noteEl = document.getElementById("planNote");
  const btn = document.getElementById("subscribeAccountBtn");
  const homeBtn = document.getElementById("subscribeBtn");

  if (!badge) return;

  if (!currentUser) {
    badge.textContent = "Free";
    badge.classList.remove("active");
    if (statusEl) statusEl.textContent = "Not signed in";
    if (planEl) planEl.textContent = "—";
    if (billingEl) billingEl.textContent = "—";
    if (noteEl) noteEl.textContent = "Sign in with Google to manage your subscription";

    if (btn) {
      btn.textContent = "Sign in with Google";
      btn.onclick = signInWithGoogle;
    }
    if (homeBtn) {
      homeBtn.textContent = "Sign in with Google";
      homeBtn.onclick = signInWithGoogle;
    }
    return;
  }

  const email = currentUser.email || "User";

  if (isSubscribed()) {
    const isTrial = realSubscription && realSubscription.status === "trialing";
badge.textContent = isTrial ? "Trial" : "Pro";
badge.classList.add("active");
if (statusEl) statusEl.textContent = (isTrial ? "Free Trial · " : "Active · ") + email;
if (planEl) planEl.textContent = isTrial ? "Free Trial (3 days)" : "Pro · $5/mo";
    if (billingEl) {
      billingEl.textContent = realSubscription?.current_period_end
        ? new Date(realSubscription.current_period_end).toLocaleDateString()
        : "—";
    }
    if (noteEl) noteEl.textContent = "Thank you for supporting Formix PDF!";

    if (btn) {
  btn.textContent = "Manage Subscription";
  btn.onclick = () => {
    if (STRIPE_CUSTOMER_PORTAL_LINK) {
      window.location.href = STRIPE_CUSTOMER_PORTAL_LINK;
    } else {
      if (confirm("Open customer portal or log out?")) {
        signOut();
      }
    }
  };
}
  } else {
    badge.textContent = "Free";
    badge.classList.remove("active");
    if (statusEl) statusEl.textContent = "Signed in · " + email;
    if (planEl) planEl.textContent = "Free";
    if (billingEl) billingEl.textContent = "—";
    if (noteEl) noteEl.textContent = "Subscribe to unlock unlimited PDFs";

    if (btn) {
      btn.textContent = "Subscribe — $5/mo";
      btn.onclick = goToStripeCheckout;
    }
  }

  if (homeBtn) {
    homeBtn.textContent = isSubscribed() ? "Pro Active" : "Subscribe — $5/mo";
    homeBtn.onclick = isSubscribed()
      ? () => showScreen("accountScreen")
      : goToStripeCheckout;
  }
}

// Home subscribe button
if (subscribeBtn) {
  subscribeBtn.addEventListener("click", () => {
    if (isSubscribed()) {
      showScreen("accountScreen");
      document.querySelectorAll(".nav-item").forEach((n) => n.classList.remove("active"));
      document.querySelector('.nav-item[data-screen="account"]')?.classList.add("active");
      updateAccountUI();
    } else if (currentUser) {
      goToStripeCheckout();
    } else {
      signInWithGoogle();
    }
  });
}

// Run after Stripe redirect
handleCheckoutReturn();

// ========== INIT REAL AUTH ==========
loadUserAndSubscription();

if (sb) {
  sb.auth.onAuthStateChange((_event, session) => {
    currentUser = session?.user || null;
    loadUserAndSubscription();
  });
}
// Preferences
function loadPrefs() {
  try {
    const prefs = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
    const company = document.getElementById("prefCompany");
    const contact = document.getElementById("prefContact");
    if (company) company.value = prefs.company || "";
    if (contact) contact.value = prefs.contact || "";
  } catch {}
}

function savePrefs() {
  const company = document.getElementById("prefCompany")?.value.trim() || "";
  const contact = document.getElementById("prefContact")?.value.trim() || "";
  localStorage.setItem(PREFS_KEY, JSON.stringify({ company, contact }));
  // Also prefill invoice form fields if empty
  const cn = document.getElementById("companyName");
  const cc = document.getElementById("companyContact");
  if (cn && !cn.value) cn.value = company;
  if (cc && !cc.value) cc.value = contact;
  alert("Preferences saved");
}

document.getElementById("savePrefsBtn")?.addEventListener("click", savePrefs);

document.getElementById("restorePurchaseBtn")?.addEventListener("click", () => {
  if (isSubscribed()) {
    alert("Your subscription is already active.");
  } else {
    alert("No previous purchase found.\n\nIn the real App Store / Play Store version this restores your subscription.");
  }
});
document.getElementById("logoutBtn")?.addEventListener("click", () => {
  if (confirm("Are you sure you want to log out?")) {
    signOut();
  }
});
document.getElementById("clearDataBtn")?.addEventListener("click", () => {
  if (confirm("Clear all local data?\n\nThis removes saved preferences and subscription status on this device.")) {
    localStorage.removeItem(SUB_KEY);
    localStorage.removeItem(PREFS_KEY);
    companyLogoDataUrl = null;
    updateAccountUI();
    loadPrefs();
    alert("Local data cleared.");
  }
});

// Init account UI
updateAccountUI();
loadPrefs();

// ========== AI TOOLS ==========

function processAIText(text, action) {
  const t = text.trim();
  if (!t) return "Please enter some text first.";

  switch (action) {
    case "professional":
      return makeProfessional(t);
    case "shorter":
      return makeShorter(t);
    case "friendly":
      return makeFriendly(t);
    case "clearer":
      return makeClearer(t);
    case "payment":
      return makePaymentTerms(t);
    case "summarize":
      return summarizeText(t);
    default:
      return t;
  }
}

function makeProfessional(text) {
  let out = text
    .replace(/\bi'm\b/gi, "I am")
    .replace(/\bdon't\b/gi, "do not")
    .replace(/\bcan't\b/gi, "cannot")
    .replace(/\bwon't\b/gi, "will not")
    .replace(/\bwanna\b/gi, "want to")
    .replace(/\bgonna\b/gi, "going to")
    .replace(/\bkinda\b/gi, "kind of")
    .replace(/\bthanks\b/gi, "Thank you")
    .replace(/\bpls\b/gi, "please")
    .replace(/\bplz\b/gi, "please")
    .replace(/\basap\b/gi, "as soon as possible")
    .replace(/\bfyi\b/gi, "for your information")
    .replace(/!+/g, ".")
    .replace(/\s+/g, " ")
    .trim();

  // Capitalize first letter of sentences
  out = out.replace(/(^\s*\w|[.!?]\s+\w)/g, (m) => m.toUpperCase());

  if (!/[.!?]$/.test(out)) out += ".";
  return out;
}

function makeShorter(text) {
  let out = text
    .replace(/\b(very|really|just|actually|basically|literally)\b/gi, "")
    .replace(/\bin order to\b/gi, "to")
    .replace(/\bdue to the fact that\b/gi, "because")
    .replace(/\bat this point in time\b/gi, "now")
    .replace(/\s+/g, " ")
    .trim();

  // Keep first 2-3 sentences if long
  const sentences = out.match(/[^.!?]+[.!?]+/g) || [out];
  if (sentences.length > 3) {
    out = sentences.slice(0, 2).join(" ").trim();
  }
  return out;
}

function makeFriendly(text) {
  let out = text.trim();
  if (!/^hi\b|^hello\b|^dear\b/i.test(out)) {
    out = "Hi there — " + out.charAt(0).toLowerCase() + out.slice(1);
  }
  out = out
    .replace(/\bI require\b/gi, "I need")
    .replace(/\bplease be advised\b/gi, "just a note")
    .replace(/\bregarding the matter of\b/gi, "about");

  if (!/thank/i.test(out)) {
    out = out.replace(/[.!?]?$/, "") + ". Thank you!";
  }
  return out;
}

function makeClearer(text) {
  return text
    .replace(/\s+/g, " ")
    .replace(/\b(etc)\b/gi, "and so on")
    .replace(/\bi\.e\./gi, "that is")
    .replace(/\be\.g\./gi, "for example")
    .replace(/([.!?])\s*([a-z])/g, (m, p, l) => p + " " + l.toUpperCase())
    .trim();
}

function makePaymentTerms(text) {
  // If user typed something short, turn it into clear payment terms
  const lower = text.toLowerCase();
  if (lower.length < 40 || /payment|due|net|days/i.test(lower) === false) {
    return (
      "Payment is due within 15 days of the invoice date. " +
      "Please include the invoice number with your payment. " +
      "Late payments may be subject to a 1.5% monthly fee. Thank you for your business."
    );
  }
  return makeProfessional(text);
}

function summarizeText(text) {
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  if (sentences.length <= 2) return text.trim();
  // Take first and last sentence as simple summary
  const first = sentences[0].trim();
  const last = sentences[sentences.length - 1].trim();
  if (first === last) return first;
  return first + " " + last;
}

// AI action buttons
document.querySelectorAll(".ai-action-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const action = btn.dataset.action;
    const input = aiInput.value;
    const result = processAIText(input, action);
    aiOutput.value = result;
    aiResultGroup.style.display = "block";
  });
});

if (aiCopyBtn) {
  aiCopyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(aiOutput.value);
      aiCopyBtn.textContent = "Copied!";
      setTimeout(() => { aiCopyBtn.textContent = "Copy Result"; }, 1500);
    } catch {
      aiOutput.select();
      document.execCommand("copy");
      aiCopyBtn.textContent = "Copied!";
      setTimeout(() => { aiCopyBtn.textContent = "Copy Result"; }, 1500);
    }
  });
}

if (aiUseNotesBtn) {
  aiUseNotesBtn.addEventListener("click", () => {
    const notesField = document.getElementById("description");
    if (notesField) {
      notesField.value = aiOutput.value;
    }
    currentTemplate = "invoice";
    formTitle.textContent = "Create Invoice";
    showScreen("formScreen");
    setDefaultDates();
  });
}

// Bottom navigation
document.querySelectorAll(".nav-item").forEach((item) => {
  item.addEventListener("click", () => {
    document.querySelectorAll(".nav-item").forEach((n) => n.classList.remove("active"));
    item.classList.add("active");

    const screen = item.dataset.screen;
    if (screen === "home") {
      showScreen("home");
    } else if (screen === "ai") {
      showScreen("aiScreen");
    } else if (screen === "account") {
      updateAccountUI();
      loadPrefs();
      showScreen("accountScreen");
    } else if (screen === "history") {
      renderHistory();
      showScreen("historyScreen");
    } else {
      showScreen("home");
    }
  });
});

// Init
renderCustomerSelect();

// Register service worker (PWA)
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((err) => {
      console.log("SW registration failed:", err);
    });
  });
}
