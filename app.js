/* PolyMask — standalone polygon mask annotator.
 * No dependencies, no build step, no network. All processing stays in the browser.
 */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const els = {
    importFilesBtn: $('importFilesBtn'),
    importFolderBtn: $('importFolderBtn'),
    exportBtn: $('exportBtn'),
    headerProgressText: $('headerProgressText'),
    headerProgressBar: $('headerProgressBar'),
    sidebarProgressText: $('sidebarProgressText'),
    sidebarProgressBar: $('sidebarProgressBar'),
    defectStats: $('defectStats'),
    pendingStats: $('pendingStats'),
    libraryCount: $('libraryCount'),
    filterAllCount: $('filterAllCount'),
    filterTodoCount: $('filterTodoCount'),
    filterDoneCount: $('filterDoneCount'),
    imageList: $('imageList'),
    listEmpty: $('listEmpty'),
    currentName: $('currentName'),
    dirtyBadge: $('dirtyBadge'),
    currentMeta: $('currentMeta'),
    zoomOutBtn: $('zoomOutBtn'),
    zoomInBtn: $('zoomInBtn'),
    zoomLabel: $('zoomLabel'),
    fitBtn: $('fitBtn'),
    stage: $('stage'),
    canvas: $('canvas'),
    emptyStage: $('emptyStage'),
    stageLoading: $('stageLoading'),
    modeChip: $('modeChip'),
    canvasReadout: $('canvasReadout'),
    coordText: $('coordText'),
    readoutSize: $('readoutSize'),
    zoomToast: $('zoomToast'),
    polygonCount: $('polygonCount'),
    draftCard: $('draftCard'),
    draftCount: $('draftCount'),
    draftCloseBtn: $('draftCloseBtn'),
    draftCancelBtn: $('draftCancelBtn'),
    polygonList: $('polygonList'),
    inspectorEmpty: $('inspectorEmpty'),
    inspectorEmptyTitle: $('inspectorEmptyTitle'),
    inspectorEmptyText: $('inspectorEmptyText'),
    clearRow: $('clearRow'),
    clearPolygonsBtn: $('clearPolygonsBtn'),
    maskSizeText: $('maskSizeText'),
    saveBtn: $('saveBtn'),
    saveBtnText: $('saveBtnText'),
    saveNextBtn: $('saveNextBtn'),
    saveNote: $('saveNote'),
    fileInput: $('fileInput'),
    folderInput: $('folderInput'),
    dragOverlay: $('dragOverlay'),
    toastHost: $('toastHost'),
    confirmModal: $('confirmModal'),
    confirmKicker: $('confirmKicker'),
    confirmTitle: $('confirmTitle'),
    confirmMessage: $('confirmMessage'),
    confirmCancelBtn: $('confirmCancelBtn'),
    confirmOkBtn: $('confirmOkBtn'),
    exportModal: $('exportModal'),
    exportTitle: $('exportTitle'),
    exportMessage: $('exportMessage'),
    exportProgressBar: $('exportProgressBar'),
    exportCurrent: $('exportCurrent'),
    exportCount: $('exportCount'),
    exportHint: $('exportHint'),
    exportCancelBtn: $('exportCancelBtn'),
    emptyFilesBtn: $('emptyFilesBtn'),
    emptyFolderBtn: $('emptyFolderBtn'),
    inspector: $('inspector'),
    inspectorToggleBtn: $('inspectorToggleBtn'),
    inspectorToggleCount: $('inspectorToggleCount'),
    inspectorCloseBtn: $('inspectorCloseBtn'),
    stageError: $('stageError'),
    stageErrorText: $('stageErrorText'),
    stageErrorRemoveBtn: $('stageErrorRemoveBtn'),
  };

  const SUPPORTED_EXT = /\.(jpe?g|png|webp|bmp|gif|avif)$/i;
  const MAX_FILES = 2000;
  const HANDLE_RADIUS = 9;
  const MIN_ZOOM = 0.025;
  const MAX_ZOOM = 32;
  const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });
  const numberFormatter = new Intl.NumberFormat('zh-CN');

  const state = {
    items: [],
    byId: new Map(),
    currentId: null,
    filter: 'all',
    saving: false,
    exporting: false,
    exportCancelled: false,
    view: { scale: 1, x: 0, y: 0 },
    fitMode: true,
    spaceDown: false,
    hover: null,
    drag: null,
    pan: null,
    suppressClick: false,
    pointerId: null,
    loadingToken: 0,
    listSignature: '',
    cardMap: new Map(),
    polygonSeq: 1,
    confirm: { resolve: null, previousFocus: null },
    zoomToastTimer: 0,
    fileSeq: 1,
  };

  /* ───────────────────────────── Utilities ───────────────────────────── */

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const round2 = (value) => Math.round(value * 100) / 100;
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  function formatArea(area) {
    if (!Number.isFinite(area) || area <= 0) return '0 px²';
    if (area >= 1000000) return `${(area / 1000000).toFixed(2)} M px²`;
    if (area >= 10000) return `${(area / 10000).toFixed(1)} 万 px²`;
    return `${Math.round(area)} px²`;
  }

  function polygonArea(points) {
    if (!points || points.length < 3) return 0;
    let sum = 0;
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      sum += a.x * b.y - b.x * a.y;
    }
    return Math.abs(sum) / 2;
  }

  function getCurrentItem() {
    return state.currentId ? state.byId.get(state.currentId) || null : null;
  }

  function isItemSaved(item) {
    return Boolean(item) && item.savedRevision === item.revision && !item.draft.length;
  }

  function getItemState(item) {
    if (item.status === 'error') return 'error';
    if (item.status === 'loading') return 'loading';
    if (item.draft.length) return 'draft';
    if (isItemSaved(item)) return 'done';
    if (item.revision > 0 || item.polygons.length) return 'dirty';
    return 'idle';
  }

  function naturalCompare(a, b) {
    return collator.compare(a, b);
  }

  function normalizePath(path) {
    return String(path || '').replace(/\\/g, '/').replace(/^\/+/, '');
  }

  function basenameOf(path) {
    const normalized = normalizePath(path);
    const parts = normalized.split('/');
    return parts[parts.length - 1] || normalized;
  }

  function stripExtension(name) {
    const dot = name.lastIndexOf('.');
    if (dot <= 0) return name;
    return name.slice(0, dot);
  }

  function showToast(message, type = 'info', duration = 3000) {
    if (!els.toastHost) return;
    while (els.toastHost.children.length >= 3) {
      els.toastHost.firstElementChild.remove();
    }
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    const dot = document.createElement('span');
    dot.className = 'toast-dot';
    const text = document.createElement('span');
    text.textContent = message;
    toast.append(dot, text);
    els.toastHost.appendChild(toast);
    const remove = () => {
      if (!toast.isConnected) return;
      toast.classList.add('is-leaving');
      window.setTimeout(() => toast.remove(), 180);
    };
    const timer = window.setTimeout(remove, duration);
    toast.addEventListener('click', () => {
      window.clearTimeout(timer);
      remove();
    });
  }

  function showZoomToast(text) {
    if (!els.zoomToast) return;
    els.zoomToast.textContent = text;
    els.zoomToast.classList.add('is-visible');
    window.clearTimeout(state.zoomToastTimer);
    state.zoomToastTimer = window.setTimeout(() => {
      els.zoomToast.classList.remove('is-visible');
    }, 900);
  }

  function setInspectorOpen(open) {
    if (!els.inspector) return;
    els.inspector.classList.toggle('is-open', open);
    if (els.inspectorToggleBtn) {
      els.inspectorToggleBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
  }

  function isCompactInspector() {
    return window.matchMedia('(max-width: 1120px)').matches;
  }

  /* ───────────────────────────── Import ───────────────────────────── */

  function isImageFile(file) {
    if (!file || !file.name) return false;
    if (file.name.startsWith('._') || file.name === '.DS_Store') return false;
    return SUPPORTED_EXT.test(file.name) || (typeof file.type === 'string' && file.type.startsWith('image/'));
  }

  async function importFileInfos(infos, sourceLabel = '') {
    if (!Array.isArray(infos) || infos.length === 0) {
      showToast('没有找到支持的图片文件', 'error');
      return;
    }

    const clean = infos
      .filter((info) => info && isImageFile(info.file))
      .map((info) => ({
        file: info.file,
        path: normalizePath(info.path || info.file.webkitRelativePath || info.file.name),
      }))
      .sort((a, b) => naturalCompare(a.path, b.path));

    if (!clean.length) {
      showToast('没有找到支持的图片（JPG / PNG / WEBP / BMP / GIF / AVIF）', 'error');
      return;
    }

    const existingKeys = new Set(state.items.map((item) => item.key));
    let added = 0;
    let skipped = 0;
    let overflow = false;
    const firstNew = [];

    for (const info of clean) {
      if (state.items.length >= MAX_FILES) {
        overflow = true;
        break;
      }
      const { file } = info;
      const path = info.path || file.name;
      const key = `${path}|${file.size}|${file.lastModified}`;
      if (existingKeys.has(key)) {
        skipped += 1;
        continue;
      }
      existingKeys.add(key);
      const name = basenameOf(path) || file.name;
      let url = '';
      try {
        url = URL.createObjectURL(file);
      } catch (error) {
        skipped += 1;
        continue;
      }
      const item = {
        id: `img_${state.fileSeq++}`,
        key,
        file,
        name,
        path,
        relativePath: path,
        baseName: stripExtension(name) || 'image',
        extension: (name.split('.').pop() || '').toLowerCase(),
        size: file.size,
        url,
        image: null,
        loadPromise: null,
        width: 0,
        height: 0,
        polygons: [],
        draft: [],
        selectedPolygonId: null,
        revision: 0,
        savedRevision: -1,
        savedDefectCount: 0,
        maskBlob: null,
        maskRevision: -1,
        maskWidth: 0,
        maskHeight: 0,
        status: 'idle',
        error: null,
      };
      state.items.push(item);
      state.byId.set(item.id, item);
      firstNew.push(item);
      added += 1;
    }

    renderAll();

    if (added > 0 && !state.currentId) {
      await selectItem(firstNew[0].id);
    }

    if (added > 0) {
      const extra = skipped ? `，忽略 ${skipped} 个重复或不支持的文件` : '';
      showToast(`已导入 ${added} 张图片${extra}`, 'success');
    } else if (skipped > 0) {
      showToast('这些图片已经在列表里了', 'info');
    }
    if (overflow) {
      showToast(`一次最多导入 ${MAX_FILES} 张图片，超出的部分已忽略`, 'error', 5000);
    }
    if (sourceLabel && added > 0 && state.items.length === added) {
      showToast(sourceLabel, 'info', 2200);
    }
  }

  function filesToInfos(fileList) {
    return Array.from(fileList || [])
      .filter((file) => isImageFile(file))
      .map((file) => ({ file, path: file.webkitRelativePath || file.name }));
  }

  async function readEntry(entry, prefix, out, depth = 0) {
    if (!entry || out.length >= MAX_FILES || depth > 24) return;
    if (entry.isFile) {
      await new Promise((resolve) => {
        entry.file(
          (file) => {
            if (isImageFile(file)) {
              out.push({ file, path: `${prefix}${file.name}` });
            }
            resolve();
          },
          () => resolve(),
        );
      });
      return;
    }
    if (entry.isDirectory) {
      const reader = entry.createReader();
      const nextPrefix = `${prefix}${entry.name}/`;
      while (out.length < MAX_FILES) {
        const batch = await new Promise((resolve) => {
          reader.readEntries(resolve, () => resolve([]));
        });
        if (!batch || !batch.length) break;
        for (const child of batch) {
          if (out.length >= MAX_FILES) break;
          await readEntry(child, nextPrefix, out, depth + 1);
        }
      }
    }
  }

  async function infosFromDataTransfer(dataTransfer) {
    const out = [];
    if (!dataTransfer) return out;
    const items = Array.from(dataTransfer.items || []);
    const entries = [];
    for (const item of items) {
      if (item.kind !== 'file') continue;
      if (typeof item.webkitGetAsEntry === 'function') {
        const entry = item.webkitGetAsEntry();
        if (entry) entries.push(entry);
      }
    }
    if (entries.length) {
      for (const entry of entries) {
        if (out.length >= MAX_FILES) break;
        await readEntry(entry, '', out, 0);
      }
    }
    if (!out.length) {
      for (const file of Array.from(dataTransfer.files || [])) {
        if (isImageFile(file)) out.push({ file, path: file.name });
      }
    }
    return out;
  }

  /* ───────────────────────────── Selection / loading ───────────────────────────── */

  function loadItemImage(item) {
    if (!item) return Promise.reject(new Error('没有图片'));
    if (item.image) return Promise.resolve(item);
    if (item.loadPromise) return item.loadPromise;

    item.loadPromise = new Promise((resolve, reject) => {
      const image = new Image();
      image.decoding = 'async';
      image.onload = () => {
        if (!image.naturalWidth || !image.naturalHeight) {
          reject(new Error('图片尺寸无效'));
          return;
        }
        item.image = image;
        item.width = image.naturalWidth;
        item.height = image.naturalHeight;
        item.error = null;
        resolve(item);
      };
      image.onerror = () => reject(new Error('浏览器无法解码这张图片'));
      image.src = item.url;
    }).finally(() => {
      item.loadPromise = null;
    });

    return item.loadPromise;
  }

  async function selectItem(id) {
    const item = state.byId.get(id);
    if (!item) return;
    if (state.saving || state.exporting) return;
    if (state.currentId === id && item.image) {
      setInspectorOpen(isCompactInspector() ? true : false);
      return;
    }

    state.currentId = id;
    state.drag = null;
    state.pan = null;
    state.hover = null;
    state.fitMode = true;
    setInspectorOpen(false);
    renderAll();

    const token = ++state.loadingToken;
    if (item.image) {
      item.status = 'ready';
      fitView();
      renderAll();
      scrollCurrentIntoView();
      return;
    }

    item.status = 'loading';
    item.error = null;
    renderAll();

    try {
      await loadItemImage(item);
      if (token !== state.loadingToken || state.currentId !== id) return;
      item.status = 'ready';
      fitView();
      renderAll();
      scrollCurrentIntoView();
    } catch (error) {
      if (token !== state.loadingToken || state.currentId !== id) return;
      console.error('[PolyMask] image load failed', item.name, error);
      item.status = 'error';
      item.error = error instanceof Error ? error.message : String(error);
      renderAll();
      showToast(`无法读取 ${item.name}：${item.error}`, 'error', 5000);
    }
  }

  function scrollCurrentIntoView() {
    if (!state.currentId) return;
    const card = state.cardMap.get(state.currentId);
    if (card && typeof card.scrollIntoView === 'function') {
      card.scrollIntoView({ block: 'nearest' });
    }
  }

  async function removeItem(id) {
    if (state.saving || state.exporting) return;
    const item = state.byId.get(id);
    if (!item) return;
    const hasWork = item.polygons.length > 0 || item.draft.length > 0 || item.savedRevision >= 0;
    if (hasWork) {
      const ok = await askConfirm({
        kicker: 'REMOVE IMAGE',
        title: '移除这张图片？',
        message: `“${item.name}”的标注和已生成的掩码都会从当前会话中移除，此操作不可撤销。`,
        okText: '移除',
        danger: true,
      });
      if (!ok) return;
    }

    const index = state.items.findIndex((entry) => entry.id === id);
    const wasCurrent = state.currentId === id;
    state.items = state.items.filter((entry) => entry.id !== id);
    state.byId.delete(id);
    state.cardMap.delete(id);
    try {
      URL.revokeObjectURL(item.url);
    } catch (error) {
      /* ignore */
    }

    if (wasCurrent) {
      state.currentId = null;
      state.loadingToken += 1;
      state.hover = null;
      state.drag = null;
      const fallback = state.items[Math.min(index, state.items.length - 1)] || state.items[0];
      if (fallback) {
        renderAll();
        await selectItem(fallback.id);
      } else {
        state.view = { scale: 1, x: 0, y: 0 };
        state.fitMode = true;
        renderAll();
        renderCanvas();
      }
    } else {
      renderAll();
    }
    showToast(`已移除 ${item.name}`, 'info');
  }

  /* ───────────────────────────── Editing ───────────────────────────── */

  function markItemChanged(item) {
    item.revision += 1;
    item.status = item.status === 'error' ? 'error' : 'ready';
  }

  function selectPolygon(id) {
    const item = getCurrentItem();
    if (!item) return;
    item.selectedPolygonId = id;
    renderAll();
  }

  function startDraft(point) {
    const item = getCurrentItem();
    if (!item) return;
    item.draft = [point];
    item.selectedPolygonId = null;
    renderAll();
  }

  function addDraftPoint(point) {
    const item = getCurrentItem();
    if (!item) return;
    const draft = item.draft;
    if (draft.length) {
      const last = draft[draft.length - 1];
      if (Math.abs(last.x - point.x) < 0.5 && Math.abs(last.y - point.y) < 0.5) return;
    }
    draft.push(point);
    renderAll();
  }

  function cancelDraft() {
    const item = getCurrentItem();
    if (!item || !item.draft.length) return;
    item.draft = [];
    state.hover = null;
    renderAll();
    showToast('已取消当前未闭合的多边形', 'info', 1800);
  }

  function closeDraft() {
    const item = getCurrentItem();
    if (!item) return;
    if (item.draft.length < 3) {
      showToast('至少需要 3 个顶点才能闭合多边形', 'error', 2400);
      return;
    }
    const area = polygonArea(item.draft);
    if (area < 0.5) {
      showToast('多边形面积太小，请继续勾画', 'error', 2400);
      return;
    }
    const polygon = {
      id: state.polygonSeq++,
      points: item.draft.map((point) => ({ x: round2(point.x), y: round2(point.y) })),
    };
    item.polygons.push(polygon);
    item.draft = [];
    item.selectedPolygonId = polygon.id;
    markItemChanged(item);
    state.hover = null;
    renderAll();
  }

  function deleteSelectedPolygon() {
    const item = getCurrentItem();
    if (!item || item.selectedPolygonId == null) return;
    const polygon = item.polygons.find((entry) => entry.id === item.selectedPolygonId);
    if (!polygon) return;
    item.polygons = item.polygons.filter((entry) => entry.id !== polygon.id);
    item.selectedPolygonId = null;
    markItemChanged(item);
    renderAll();
    showToast('已删除多边形', 'info', 1800);
  }

  function deleteVertex(hit) {
    if (!hit) return;
    const item = getCurrentItem();
    if (!item || state.saving || state.exporting) return;
    if (hit.kind === 'draft') {
      item.draft.splice(hit.index, 1);
      if (!item.draft.length) item.draft = [];
      renderAll();
      return;
    }
    const polygon = hit.polygon;
    if (!polygon) return;
    polygon.points.splice(hit.index, 1);
    if (polygon.points.length < 3) {
      item.polygons = item.polygons.filter((entry) => entry.id !== polygon.id);
      if (item.selectedPolygonId === polygon.id) item.selectedPolygonId = null;
      markItemChanged(item);
      renderAll();
      showToast('顶点不足 3 个，已删除整条多边形', 'info', 2300);
      return;
    }
    markItemChanged(item);
    renderAll();
  }

  async function clearPolygons() {
    const item = getCurrentItem();
    if (!item || (!item.polygons.length && !item.draft.length)) return;
    const ok = await askConfirm({
      kicker: 'CLEAR ANNOTATIONS',
      title: '清空本图多边形？',
      message: `“${item.name}”上的 ${item.polygons.length} 个多边形${item.draft.length ? '和正在绘制的草稿' : ''}都会被删除。图片本身仍保留在列表中。`,
      okText: '清空',
      danger: true,
    });
    if (!ok) return;
    item.polygons = [];
    item.draft = [];
    item.selectedPolygonId = null;
    markItemChanged(item);
    renderAll();
    showToast('已清空本图多边形，可重新勾画', 'info');
  }

  /* ───────────────────────────── Save ───────────────────────────── */

  async function saveCurrent(goNext = false) {
    const item = getCurrentItem();
    if (!item || state.saving || state.exporting) return;
    if (!item.image || item.status === 'loading') {
      showToast('图片还在读取中，请稍候', 'info');
      return;
    }
    if (item.status === 'error') {
      showToast('这张图片无法读取，不能保存', 'error');
      return;
    }
    if (item.draft.length) {
      showToast('请先闭合或取消当前正在绘制的多边形', 'error', 3200);
      return;
    }

    state.saving = true;
    renderEditorHeader();
    renderControls();

    const revision = item.revision;
    try {
      const maskBlob = await generateMask(item, revision);
      if (item.revision !== revision) {
        showToast('标注在保存过程中发生了变化，请重新保存', 'error');
        return;
      }
      item.maskBlob = maskBlob;
      item.maskRevision = revision;
      item.maskWidth = item.width;
      item.maskHeight = item.height;
      item.savedRevision = revision;
      item.savedDefectCount = item.polygons.length;
      item.status = 'ready';

      if (item.polygons.length) {
        showToast(`已保存 · ${item.polygons.length} 个缺陷区域`, 'success', 2400);
      } else {
        showToast('已保存全 0 掩码（本图无缺陷）', 'success', 2600);
      }

      if (goNext) {
        const index = state.items.findIndex((entry) => entry.id === item.id);
        const next = state.items[index + 1] || null;
        if (next) {
          if (isCompactInspector()) setInspectorOpen(false);
          state.saving = false;
          await selectItem(next.id);
        } else {
          showToast('已经是最后一张图片', 'info', 2200);
        }
      }
    } catch (error) {
      console.error('[PolyMask] save failed', error);
      showToast(`保存失败：${error instanceof Error ? error.message : String(error)}`, 'error', 5000);
    } finally {
      state.saving = false;
      renderAll();
    }
  }

  /* ───────────────────────────── Rendering: shell ───────────────────────────── */

  function renderAll() {
    renderProgress();
    renderImageList(false);
    renderEditorHeader();
    renderInspector();
    renderControls();
    renderCanvas();
  }

  function renderProgress() {
    const total = state.items.length;
    let done = 0;
    let defectImages = 0;
    let emptyImages = 0;

    for (const item of state.items) {
      if (isItemSaved(item)) {
        done += 1;
        if (item.savedDefectCount > 0) defectImages += 1;
        else emptyImages += 1;
      }
    }

    const pending = total - done;
    const percent = total ? (done / total) * 100 : 0;
    els.headerProgressText.textContent = `${done} / ${total}`;
    els.headerProgressBar.style.width = `${percent}%`;
    els.sidebarProgressText.textContent = `${done} / ${total}`;
    els.sidebarProgressBar.style.width = `${percent}%`;
    els.defectStats.textContent = `缺陷 ${defectImages} · 空掩码 ${emptyImages}`;
    els.pendingStats.textContent = `待处理 ${pending}`;
    els.libraryCount.textContent = String(total);
    els.filterAllCount.textContent = String(total);
    els.filterTodoCount.textContent = String(pending);
    els.filterDoneCount.textContent = String(done);

    const exportLabel = els.exportBtn.querySelector('span');
    if (exportLabel) exportLabel.textContent = state.exporting ? '正在导出…' : '导出掩码';
  }

  function filteredItems() {
    if (state.filter === 'todo') return state.items.filter((item) => !isItemSaved(item));
    if (state.filter === 'done') return state.items.filter((item) => isItemSaved(item));
    return state.items;
  }

  function createImageCard(item) {
    const card = document.createElement('div');
    card.className = 'image-card';
    card.dataset.id = item.id;
    card.setAttribute('role', 'option');
    card.setAttribute('tabindex', '0');

    const thumb = document.createElement('div');
    thumb.className = 'thumb';
    const img = document.createElement('img');
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.addEventListener('load', () => img.classList.add('is-loaded'));
    img.addEventListener('error', () => {
      img.style.visibility = 'hidden';
    });
    img.src = item.url;
    const status = document.createElement('span');
    status.className = 'thumb-state';
    status.setAttribute('aria-hidden', 'true');
    thumb.append(img, status);

    const info = document.createElement('div');
    info.className = 'image-info';
    const name = document.createElement('span');
    name.className = 'image-name';
    const sub = document.createElement('span');
    sub.className = 'image-sub';
    info.append(name, sub);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'card-remove';
    remove.title = '从列表移除';
    remove.setAttribute('aria-label', `移除 ${item.name}`);
    remove.innerHTML = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';

    card.append(thumb, info, remove);
    card._refs = { name, sub, status };
    return card;
  }

  function imageSubText(item) {
    const kind = getItemState(item);
    if (kind === 'error') return '无法读取 · 建议移除';
    if (kind === 'loading') return '正在读取…';
    if (kind === 'draft') return `绘制中 · ${item.draft.length} 个顶点`;
    if (kind === 'done') {
      const dims = item.width ? `${item.width}×${item.height} · ` : '';
      return item.savedDefectCount > 0 ? `${dims}${item.savedDefectCount} 个缺陷` : `${dims}空掩码`;
    }
    if (kind === 'dirty') return `${item.polygons.length} 个多边形 · 未保存`;
    if (item.width) return `${item.width}×${item.height} · ${formatBytes(item.size)}`;
    return formatBytes(item.size);
  }

  function updateImageCard(card, item) {
    const kind = getItemState(item);
    card.classList.toggle('is-active', item.id === state.currentId);
    card.classList.remove('state-idle', 'state-loading', 'state-draft', 'state-dirty', 'state-done', 'state-error');
    card.classList.add(`state-${kind}`);
    card.setAttribute('aria-selected', item.id === state.currentId ? 'true' : 'false');
    card.title = item.relativePath;
    const refs = card._refs;
    if (refs) {
      refs.name.textContent = item.name;
      refs.sub.textContent = imageSubText(item);
    }
  }

  function renderImageList(force) {
    const items = filteredItems();
    const signature = `${state.filter}|${items.map((item) => item.id).join(',')}`;
    if (force || signature !== state.listSignature) {
      state.listSignature = signature;
      const scrollTop = els.imageList.scrollTop;
      for (const card of els.imageList.querySelectorAll('.image-card')) card.remove();
      for (const key of Array.from(state.cardMap.keys())) {
        if (!state.byId.has(key)) state.cardMap.delete(key);
      }
      const fragment = document.createDocumentFragment();
      for (const item of items) {
        let card = state.cardMap.get(item.id);
        if (!card) {
          card = createImageCard(item);
          state.cardMap.set(item.id, card);
        }
        fragment.appendChild(card);
      }
      els.imageList.appendChild(fragment);
      els.imageList.scrollTop = scrollTop;
    }

    els.listEmpty.hidden = items.length > 0;
    if (!items.length) {
      const title = els.listEmpty.querySelector('p');
      const text = els.listEmpty.querySelector('span:last-child');
      if (state.items.length) {
        if (title) title.textContent = '没有符合条件的图片';
        if (text) text.textContent = state.filter === 'done' ? '还没有已完成的图片' : '当前筛选下没有待完成的图片';
      } else {
        if (title) title.textContent = '列表还是空的';
        if (text) text.textContent = '添加图片后会显示在这里';
      }
    }

    for (const item of items) {
      const card = state.cardMap.get(item.id);
      if (card) updateImageCard(card, item);
    }
  }

  function renderEditorHeader() {
    const item = getCurrentItem();
    if (!item) {
      els.currentName.textContent = '未选择图片';
      els.currentMeta.textContent = '导入图片或文件夹开始标注';
      els.dirtyBadge.hidden = true;
      els.dirtyBadge.className = 'save-badge';
      els.maskSizeText.textContent = '—';
      els.saveNote.textContent = '保存后会立即生成掩码，导出时统一打包。';
      els.saveNote.classList.remove('is-warn');
      return;
    }

    els.currentName.textContent = item.name;
    els.currentName.title = item.relativePath;
    els.currentName.closest('.file-title-row').title = item.relativePath;

    if (item.status === 'loading') {
      els.currentMeta.textContent = '正在读取图片…';
    } else if (item.status === 'error') {
      els.currentMeta.textContent = `${item.relativePath} · 无法读取`;
    } else {
      const dimensions = item.width ? `${item.width} × ${item.height} px` : '尺寸读取中';
      els.currentMeta.textContent = `${item.relativePath} · ${dimensions} · ${item.polygons.length} 个多边形`;
    }
    els.currentMeta.title = item.relativePath;

    const kind = getItemState(item);
    els.dirtyBadge.hidden = false;
    els.dirtyBadge.className = 'save-badge';
    if (kind === 'draft') {
      els.dirtyBadge.textContent = '绘制中';
      els.dirtyBadge.classList.add('is-draft');
    } else if (kind === 'done') {
      els.dirtyBadge.textContent = '已保存';
      els.dirtyBadge.classList.add('is-saved');
    } else if (kind === 'dirty') {
      els.dirtyBadge.textContent = '未保存';
      els.dirtyBadge.classList.add('is-dirty');
    } else if (kind === 'error') {
      els.dirtyBadge.textContent = '读取失败';
      els.dirtyBadge.classList.add('is-dirty');
    } else if (kind === 'loading') {
      els.dirtyBadge.textContent = '读取中';
    } else {
      els.dirtyBadge.textContent = '未标注';
    }

    els.maskSizeText.textContent = item.width ? `${item.width} × ${item.height} px` : '读取后确定';
    els.saveNote.classList.remove('is-warn');
    if (state.saving) {
      els.saveNote.textContent = '正在生成 8-bit 灰度掩码…';
    } else if (item.status === 'error') {
      els.saveNote.textContent = '图片无法解码，请移除后重新导入。';
      els.saveNote.classList.add('is-warn');
    } else if (item.draft.length) {
      els.saveNote.textContent = '当前多边形尚未闭合：闭合或取消后才能保存。';
      els.saveNote.classList.add('is-warn');
    } else if (kind === 'done') {
      els.saveNote.textContent = item.polygons.length
        ? '已保存。再次修改后需要重新保存。'
        : '本图无缺陷，已保存为全 0 掩码。';
    } else if (item.polygons.length === 0) {
      els.saveNote.textContent = '本图没有缺陷：保存会生成全 0 掩码，不会被跳过。';
    } else {
      els.saveNote.textContent = '保存后会立即生成掩码，导出时统一打包。';
    }
  }

  function renderInspector() {
    const item = getCurrentItem();
    const polygons = item ? item.polygons : [];
    const draft = item ? item.draft : [];
    els.polygonCount.textContent = String(polygons.length);
    if (els.inspectorToggleCount) els.inspectorToggleCount.textContent = String(polygons.length);

    els.draftCard.hidden = !draft.length;
    if (draft.length) {
      els.draftCount.textContent = `${draft.length} 个顶点`;
      els.draftCloseBtn.disabled = draft.length < 3;
    } else {
      els.draftCount.textContent = '0 个顶点';
    }

    els.polygonList.textContent = '';
    const fragment = document.createDocumentFragment();
    polygons.forEach((polygon, index) => {
      const row = document.createElement('div');
      row.className = 'polygon-item';
      if (item && item.selectedPolygonId === polygon.id) row.classList.add('is-selected');
      row.dataset.polygonId = String(polygon.id);

      const main = document.createElement('button');
      main.type = 'button';
      main.className = 'poly-item-main';
      main.dataset.polygonId = String(polygon.id);
      main.title = '选中并编辑这条多边形';
      const badge = document.createElement('span');
      badge.className = 'poly-index';
      badge.textContent = `P${index + 1}`;
      const copy = document.createElement('span');
      copy.className = 'poly-copy';
      const title = document.createElement('strong');
      title.textContent = '缺陷区域';
      const meta = document.createElement('span');
      meta.textContent = `${polygon.points.length} 顶点 · ${formatArea(polygonArea(polygon.points))}`;
      copy.append(title, meta);
      main.append(badge, copy);

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'poly-delete';
      del.dataset.deletePolygon = String(polygon.id);
      del.title = '删除这条多边形';
      del.setAttribute('aria-label', `删除第 ${index + 1} 条多边形`);
      del.innerHTML = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 7h16M9 7V5h6v2m-8 0 1 13h8l1-13"/></svg>';

      row.append(main, del);
      fragment.appendChild(row);
    });
    els.polygonList.appendChild(fragment);

    const hasAny = polygons.length > 0 || draft.length > 0;
    els.inspectorEmpty.hidden = hasAny && Boolean(item);
    if (!item) {
      els.inspectorEmptyTitle.textContent = '还没有图片';
      els.inspectorEmptyText.textContent = '从左侧选择或导入图片后，就可以开始勾画缺陷。';
    } else if (!hasAny) {
      els.inspectorEmptyTitle.textContent = '还没有多边形';
      els.inspectorEmptyText.textContent = '单击开始勾画；拖动顶点微调，右键删点。';
    }
    els.clearRow.hidden = polygons.length === 0;
  }

  function renderControls() {
    const item = getCurrentItem();
    const ready = Boolean(item && item.image && item.status === 'ready');
    const busy = state.saving || state.exporting;
    const canEdit = ready && !busy;
    const hasDraft = Boolean(item && item.draft.length);

    els.saveBtn.disabled = !canEdit || hasDraft;
    els.saveNextBtn.disabled = !canEdit || hasDraft;
    els.saveBtnText.textContent = state.saving ? '正在生成掩码…' : '保存标注';
    els.exportBtn.disabled = state.items.length === 0 || busy;

    els.zoomOutBtn.disabled = !ready;
    els.zoomInBtn.disabled = !ready;
    els.zoomLabel.disabled = !ready;
    els.fitBtn.disabled = !ready;
    els.zoomLabel.textContent = `${Math.round(state.view.scale * 100)}%`;

    els.emptyStage.hidden = Boolean(item);
    els.stageLoading.hidden = !(item && item.status === 'loading');
    els.modeChip.hidden = !ready;
    els.canvasReadout.hidden = !ready;

    const isError = Boolean(item && item.status === 'error');
    if (els.stageError) els.stageError.hidden = !isError;
    if (els.stageErrorText && isError && item) {
      els.stageErrorText.textContent = `${item.name} · ${item.error || '浏览器无法解码这个文件'}`;
    }

    if (item && item.image) {
      els.readoutSize.textContent = `${item.width} × ${item.height}`;
    } else {
      els.readoutSize.textContent = '—';
      els.coordText.textContent = 'X — · Y —';
    }
  }

  /* ───────────────────────────── Canvas view ───────────────────────────── */

  function resizeCanvas() {
    const canvas = els.canvas;
    const rect = els.stage.getBoundingClientRect();
    const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 3));
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { width: rect.width, height: rect.height };
  }

  function fitView() {
    const item = getCurrentItem();
    if (!item || !item.image) return;
    const { width, height } = resizeCanvas();
    const padding = Math.max(24, Math.min(56, Math.min(width, height) * 0.09));
    const availableW = Math.max(20, width - padding * 2);
    const availableH = Math.max(20, height - padding * 2);
    const scale = clamp(Math.min(availableW / item.width, availableH / item.height, 4), MIN_ZOOM, MAX_ZOOM);
    state.view = {
      scale,
      x: (width - item.width * scale) / 2,
      y: (height - item.height * scale) / 2,
    };
    state.fitMode = true;
    renderCanvas();
    updateZoomLabel();
  }

  function updateZoomLabel() {
    els.zoomLabel.textContent = `${Math.round(state.view.scale * 100)}%`;
  }

  function zoomAt(screenX, screenY, factor) {
    const item = getCurrentItem();
    if (!item || !item.image) return;
    const oldScale = state.view.scale;
    const newScale = clamp(oldScale * factor, MIN_ZOOM, MAX_ZOOM);
    if (Math.abs(newScale - oldScale) < 0.00001) return;
    state.view.x = screenX - ((screenX - state.view.x) / oldScale) * newScale;
    state.view.y = screenY - ((screenY - state.view.y) / oldScale) * newScale;
    state.view.scale = newScale;
    state.fitMode = false;
    updateZoomLabel();
    renderCanvas();
    showZoomToast(`${Math.round(newScale * 100)}%`);
  }

  function resetZoom() {
    const item = getCurrentItem();
    if (!item || !item.image) return;
    const { width, height } = resizeCanvas();
    const factor = 1 / state.view.scale;
    zoomAt(width / 2, height / 2, factor);
    showZoomToast('100%');
  }

  function screenToImage(point) {
    return {
      x: (point.x - state.view.x) / state.view.scale,
      y: (point.y - state.view.y) / state.view.scale,
    };
  }

  function imageToScreen(point) {
    return {
      x: point.x * state.view.scale + state.view.x,
      y: point.y * state.view.scale + state.view.y,
    };
  }

  function eventPoint(event) {
    const rect = els.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function clampImagePoint(point, item) {
    return {
      x: round2(clamp(point.x, 0, item.width)),
      y: round2(clamp(point.y, 0, item.height)),
    };
  }

  function hitVertex(screenPoint, item) {
    if (!item) return null;
    const radiusSq = HANDLE_RADIUS * HANDLE_RADIUS;
    let best = null;
    let bestDist = radiusSq;

    for (let i = 0; i < item.draft.length; i += 1) {
      const point = imageToScreen(item.draft[i]);
      const dx = point.x - screenPoint.x;
      const dy = point.y - screenPoint.y;
      const dist = dx * dx + dy * dy;
      if (dist <= bestDist) {
        bestDist = dist;
        best = { kind: 'draft', index: i, point: item.draft[i] };
      }
    }

    const ordered = [];
    for (const polygon of item.polygons) {
      if (polygon.id === item.selectedPolygonId) ordered.push(polygon);
    }
    for (let i = item.polygons.length - 1; i >= 0; i -= 1) {
      if (item.polygons[i].id !== item.selectedPolygonId) ordered.push(item.polygons[i]);
    }
    for (const polygon of ordered) {
      for (let i = 0; i < polygon.points.length; i += 1) {
        const point = imageToScreen(polygon.points[i]);
        const dx = point.x - screenPoint.x;
        const dy = point.y - screenPoint.y;
        const dist = dx * dx + dy * dy;
        if (dist <= bestDist) {
          bestDist = dist;
          best = { kind: 'polygon', index: i, point: polygon.points[i], polygon };
        }
      }
    }
    return best;
  }

  function pointInPolygon(point, polygon) {
    const pts = polygon.points;
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i].x;
      const yi = pts[i].y;
      const xj = pts[j].x;
      const yj = pts[j].y;
      const intersects = yi > point.y !== yj > point.y
        && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;
      if (intersects) inside = !inside;
    }
    return inside;
  }

  function polygonAt(point, item) {
    if (!item) return null;
    for (let i = item.polygons.length - 1; i >= 0; i -= 1) {
      if (pointInPolygon(point, item.polygons[i])) return item.polygons[i];
    }
    return null;
  }

  function tracePolygon(ctx, points) {
    if (!points.length) return;
    ctx.beginPath();
    const first = imageToScreen(points[0]);
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < points.length; i += 1) {
      const point = imageToScreen(points[i]);
      ctx.lineTo(point.x, point.y);
    }
  }

  function drawCircle(ctx, point, radius, fill, stroke, lineWidth) {
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lineWidth || 1;
      ctx.stroke();
    }
  }

  function renderCanvas() {
    const ctx = els.canvas.getContext('2d');
    if (!ctx) return;
    const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 3));
    const cssWidth = els.canvas.width / dpr;
    const cssHeight = els.canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    const item = getCurrentItem();
    if (!item || !item.image) return;

    const scale = state.view.scale;
    const drawX = state.view.x;
    const drawY = state.view.y;
    const drawW = item.width * scale;
    const drawH = item.height * scale;

    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(item.image, drawX, drawY, drawW, drawH);
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = 'rgba(150, 164, 184, 0.26)';
    ctx.lineWidth = 1;
    ctx.strokeRect(drawX + 0.5, drawY + 0.5, Math.max(0, drawW - 1), Math.max(0, drawH - 1));
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.rect(drawX, drawY, drawW, drawH);
    ctx.clip();

    const polygons = item.polygons;
    for (const polygon of polygons) {
      const selected = polygon.id === item.selectedPolygonId;
      if (!selected) {
        tracePolygon(ctx, polygon.points);
        ctx.closePath();
        ctx.fillStyle = 'rgba(255, 107, 61, 0.16)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(15, 18, 23, 0.72)';
        ctx.lineWidth = 2.8;
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255, 150, 113, 0.92)';
        ctx.lineWidth = 1.35;
        ctx.stroke();
      }
    }

    const selectedPolygon = polygons.find((polygon) => polygon.id === item.selectedPolygonId);
    if (selectedPolygon) {
      tracePolygon(ctx, selectedPolygon.points);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255, 107, 61, 0.29)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(10, 12, 15, 0.8)';
      ctx.lineWidth = 3.2;
      ctx.stroke();
      ctx.strokeStyle = '#ff9c74';
      ctx.lineWidth = 1.8;
      ctx.stroke();
    }

    if (item.draft.length >= 3) {
      tracePolygon(ctx, item.draft);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255, 131, 86, 0.11)';
      ctx.fill();
    }

    if (item.draft.length >= 2) {
      tracePolygon(ctx, item.draft);
      ctx.strokeStyle = 'rgba(20, 12, 9, 0.72)';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.strokeStyle = '#ff9a6f';
      ctx.lineWidth = 1.8;
      ctx.stroke();
    }

    if (item.draft.length >= 3) {
      const first = imageToScreen(item.draft[0]);
      const last = imageToScreen(item.draft[item.draft.length - 1]);
      ctx.save();
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(first.x, first.y);
      ctx.strokeStyle = 'rgba(255, 154, 111, 0.65)';
      ctx.lineWidth = 1.25;
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();

    for (const polygon of polygons) {
      const selected = polygon.id === item.selectedPolygonId;
      for (const point of polygon.points) {
        const screen = imageToScreen(point);
        drawCircle(
          ctx,
          screen,
          selected ? 4.3 : 2.9,
          selected ? '#ff6b3d' : 'rgba(255, 147, 109, 0.92)',
          'rgba(12, 14, 18, 0.9)',
          1.35,
        );
        if (selected) {
          drawCircle(ctx, screen, 6.4, null, 'rgba(255, 255, 255, 0.22)', 1);
        }
      }
    }

    for (let i = 0; i < item.draft.length; i += 1) {
      const screen = imageToScreen(item.draft[i]);
      if (i === 0) {
        drawCircle(ctx, screen, 7.2, 'rgba(255, 107, 61, 0.14)', 'rgba(255, 166, 129, 0.65)', 1.2);
        drawCircle(ctx, screen, 4.6, '#ff7d4f', '#fff0e8', 1.6);
      } else {
        drawCircle(ctx, screen, 4.3, '#ff9c74', 'rgba(20, 12, 9, 0.9)', 1.3);
      }
    }

    if (state.hover) {
      const screen = imageToScreen(state.hover.point);
      drawCircle(ctx, screen, 8.6, 'rgba(255, 107, 61, 0.12)', 'rgba(255, 184, 151, 0.9)', 1.3);
    }

    ctx.save();
    ctx.strokeStyle = 'rgba(255, 107, 61, 0.26)';
    ctx.lineWidth = 1;
    ctx.strokeRect(drawX + 0.5, drawY + 0.5, Math.max(0, drawW - 1), Math.max(0, drawH - 1));
    ctx.restore();
  }

  function updateCoordReadout(screenPoint) {
    const item = getCurrentItem();
    if (!item || !item.image) {
      els.coordText.textContent = 'X — · Y —';
      return;
    }
    const point = screenToImage(screenPoint);
    if (point.x < 0 || point.y < 0 || point.x >= item.width || point.y >= item.height) {
      els.coordText.textContent = 'X — · Y —';
    } else {
      els.coordText.textContent = `X ${Math.floor(point.x)} · Y ${Math.floor(point.y)}`;
    }
  }

  /* ───────────────────────────── Pointer interaction ───────────────────────────── */

  function updateCursor(screenPoint) {
    const item = getCurrentItem();
    if (!item || !item.image) {
      els.canvas.style.cursor = 'crosshair';
      return;
    }
    if (state.pan) {
      els.canvas.style.cursor = 'grabbing';
      return;
    }
    if (state.spaceDown) {
      els.canvas.style.cursor = 'grab';
      return;
    }
    if (state.drag) {
      els.canvas.style.cursor = 'grabbing';
      return;
    }
    const hit = hitVertex(screenPoint, item);
    if (hit) {
      els.canvas.style.cursor = 'grab';
      return;
    }
    const imagePoint = screenToImage(screenPoint);
    if (polygonAt(imagePoint, item)) {
      els.canvas.style.cursor = 'pointer';
    } else {
      els.canvas.style.cursor = 'crosshair';
    }
  }

  function beginPan(event, screenPoint) {
    state.pan = {
      pointerId: event.pointerId,
      startX: screenPoint.x,
      startY: screenPoint.y,
      viewX: state.view.x,
      viewY: state.view.y,
    };
    state.suppressClick = true;
    try {
      els.canvas.setPointerCapture(event.pointerId);
    } catch (error) {
      /* ignore */
    }
    els.canvas.style.cursor = 'grabbing';
    event.preventDefault();
  }

  function beginVertexDrag(hit, event, screenPoint) {
    const item = getCurrentItem();
    if (!item) return;
    let points = null;
    if (hit.kind === 'draft') points = item.draft;
    else if (hit.polygon) points = hit.polygon.points;
    if (!points) return;
    state.drag = {
      pointerId: event.pointerId,
      kind: hit.kind,
      polygon: hit.polygon || null,
      index: hit.index,
      points,
      startX: screenPoint.x,
      startY: screenPoint.y,
      moved: false,
    };
    state.suppressClick = true;
    try {
      els.canvas.setPointerCapture(event.pointerId);
    } catch (error) {
      /* ignore */
    }
    els.canvas.style.cursor = 'grabbing';
    event.preventDefault();
  }

  function onPointerDown(event) {
    const item = getCurrentItem();
    if (!item || !item.image || state.saving || state.exporting) return;
    const screenPoint = eventPoint(event);

    if (event.button === 1 || (event.button === 0 && state.spaceDown)) {
      beginPan(event, screenPoint);
      return;
    }
    if (event.button !== 0) return;

    const hit = hitVertex(screenPoint, item);
    if (!hit) return;

    if (hit.kind === 'draft' && hit.index === 0 && item.draft.length >= 3) {
      state.suppressClick = true;
      closeDraft();
      event.preventDefault();
      return;
    }

    if (hit.kind === 'polygon' && hit.polygon) {
      item.selectedPolygonId = hit.polygon.id;
    }
    beginVertexDrag(hit, event, screenPoint);
    renderAll();
  }

  function onPointerMove(event) {
    const item = getCurrentItem();
    const screenPoint = eventPoint(event);

    if (state.pan && state.pan.pointerId === event.pointerId) {
      state.view.x = state.pan.viewX + (screenPoint.x - state.pan.startX);
      state.view.y = state.pan.viewY + (screenPoint.y - state.pan.startY);
      state.fitMode = false;
      renderCanvas();
      return;
    }

    if (state.drag && state.drag.pointerId === event.pointerId && item) {
      const dx = screenPoint.x - state.drag.startX;
      const dy = screenPoint.y - state.drag.startY;
      if (!state.drag.moved && dx * dx + dy * dy > 4) state.drag.moved = true;
      const raw = screenToImage(screenPoint);
      const point = clampImagePoint(raw, item);
      const list = state.drag.points;
      if (list && state.drag.index >= 0 && state.drag.index < list.length) {
        list[state.drag.index] = point;
        state.hover = { kind: state.drag.kind, index: state.drag.index, point };
        renderCanvas();
        updateCoordReadout(screenPoint);
      }
      return;
    }

    if (!item || !item.image) return;
    updateCoordReadout(screenPoint);

    const hit = hitVertex(screenPoint, item);
    const previous = state.hover;
    const changed = (hit && hit.point) !== (previous && previous.point)
      || (hit && hit.kind) !== (previous && previous.kind)
      || (hit && hit.index) !== (previous && previous.index);
    state.hover = hit;
    updateCursor(screenPoint);
    if (changed) renderCanvas();
  }

  function endPointerInteraction(event, cancelled) {
    const item = getCurrentItem();
    if (state.pan && state.pan.pointerId === event.pointerId) {
      state.pan = null;
      state.suppressClick = true;
      try {
        els.canvas.releasePointerCapture(event.pointerId);
      } catch (error) {
        /* ignore */
      }
      updateCursor(eventPoint(event));
      return;
    }

    if (state.drag && state.drag.pointerId === event.pointerId) {
      const drag = state.drag;
      state.drag = null;
      try {
        els.canvas.releasePointerCapture(event.pointerId);
      } catch (error) {
        /* ignore */
      }
      state.suppressClick = true;
      if (drag.moved && item) {
        markItemChanged(item);
        state.hover = null;
        renderAll();
      } else {
        updateCursor(eventPoint(event));
        renderCanvas();
      }
      if (cancelled) state.suppressClick = true;
    }
  }

  function onPointerUp(event) {
    endPointerInteraction(event, false);
  }

  function onPointerCancel(event) {
    endPointerInteraction(event, true);
  }

  function onPointerLeave() {
    if (state.drag || state.pan) return;
    if (state.hover) {
      state.hover = null;
      renderCanvas();
    }
    updateCursor({ x: -9999, y: -9999 });
    if (!state.spaceDown) els.canvas.style.cursor = 'crosshair';
    els.coordText.textContent = 'X — · Y —';
  }

  function onClick(event) {
    const item = getCurrentItem();
    if (!item || !item.image || state.saving || state.exporting) return;
    if (state.suppressClick) {
      state.suppressClick = false;
      return;
    }
    if (state.spaceDown) return;
    if (event.button !== 0) return;
    if (event.detail > 1) return;

    const screenPoint = eventPoint(event);
    const imagePoint = screenToImage(screenPoint);
    if (imagePoint.x < 0 || imagePoint.y < 0 || imagePoint.x > item.width || imagePoint.y > item.height) {
      return;
    }

    if (item.draft.length) {
      addDraftPoint(clampImagePoint(imagePoint, item));
      return;
    }

    const existing = event.altKey ? null : polygonAt(imagePoint, item);
    if (existing) {
      item.selectedPolygonId = existing.id;
      renderAll();
      return;
    }

    item.selectedPolygonId = null;
    startDraft(clampImagePoint(imagePoint, item));
  }

  function onDoubleClick(event) {
    const item = getCurrentItem();
    if (!item || !item.image || state.saving || state.exporting) return;
    if (state.spaceDown) return;
    event.preventDefault();
    if (item.draft.length) closeDraft();
  }

  function onContextMenu(event) {
    const item = getCurrentItem();
    if (!item || !item.image) return;
    event.preventDefault();
    if (state.saving || state.exporting) return;
    const screenPoint = eventPoint(event);
    const hit = hitVertex(screenPoint, item);
    if (hit) {
      deleteVertex(hit);
    }
  }

  function onWheel(event) {
    const item = getCurrentItem();
    if (!item || !item.image) return;
    event.preventDefault();
    const screenPoint = eventPoint(event);
    const factor = Math.exp(-event.deltaY * (event.ctrlKey ? 0.003 : 0.0015));
    zoomAt(screenPoint.x, screenPoint.y, factor);
  }

  /* ───────────────────────────── Keyboard ───────────────────────────── */

  function isTypingTarget(target) {
    if (!target || !(target instanceof Element)) return false;
    return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
  }

  function isButtonTarget(target) {
    return Boolean(target && target instanceof Element && target.closest('button'));
  }

  function onKeyDown(event) {
    if (!els.confirmModal.hidden) {
      if (event.key === 'Escape') {
        event.preventDefault();
        resolveConfirm(false);
      }
      return;
    }
    if (!els.exportModal.hidden) {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (els.exportModal.classList.contains('is-done')) closeExportModal();
        else cancelExport();
      }
      return;
    }
    if (state.exporting || state.saving) {
      if (event.key === 'Escape' && state.exporting) cancelExport();
      return;
    }
    if (isTypingTarget(event.target)) return;
    if (event.defaultPrevented) return;

    const item = getCurrentItem();
    const key = event.key;

    if (key === ' ' || key === 'Spacebar') {
      if (isButtonTarget(event.target)) return;
      if (!item || !item.image) return;
      if (!state.spaceDown) {
        state.spaceDown = true;
        updateCursor(eventPoint(event));
      }
      event.preventDefault();
      return;
    }

    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (!state.items.length) return;
      event.preventDefault();
      const currentIndex = item ? state.items.findIndex((entry) => entry.id === item.id) : -1;
      let nextIndex;
      if (currentIndex < 0) nextIndex = 0;
      else nextIndex = key === 'ArrowLeft' ? currentIndex - 1 : currentIndex + 1;
      if (nextIndex >= 0 && nextIndex < state.items.length) {
        selectItem(state.items[nextIndex].id);
      }
      return;
    }

    if (key === 'Backspace') {
      if (!item) return;
      event.preventDefault();
      if (item.draft.length) {
        item.draft.pop();
        state.hover = null;
        renderAll();
      }
      return;
    }

    if (key === 'Escape') {
      if (!item) return;
      event.preventDefault();
      if (item.draft.length) cancelDraft();
      else if (item.selectedPolygonId != null) {
        item.selectedPolygonId = null;
        renderAll();
      }
      return;
    }

    if (key === 'Enter') {
      if (!item || !item.draft.length) return;
      if (isButtonTarget(event.target)) return;
      event.preventDefault();
      closeDraft();
      return;
    }

    if (key === 'Delete' || key === 'Del') {
      if (!item || item.draft.length || item.selectedPolygonId == null) return;
      if (isButtonTarget(event.target)) return;
      event.preventDefault();
      deleteSelectedPolygon();
      return;
    }

    if (key === '+' || key === '=') {
      if (!item || !item.image) return;
      const { width, height } = resizeCanvas();
      zoomAt(width / 2, height / 2, 1.2);
      event.preventDefault();
      return;
    }
    if (key === '-' || key === '_') {
      if (!item || !item.image) return;
      const { width, height } = resizeCanvas();
      zoomAt(width / 2, height / 2, 1 / 1.2);
      event.preventDefault();
      return;
    }
    if (key === 'f' || key === 'F') {
      if (!item || !item.image) return;
      fitView();
      event.preventDefault();
    }
  }

  function onKeyUp(event) {
    if (event.key === ' ' || event.key === 'Spacebar') {
      if (state.spaceDown) {
        state.spaceDown = false;
        updateCursor({ x: -9999, y: -9999 });
        if (!state.pan) els.canvas.style.cursor = 'crosshair';
      }
    }
  }

  /* ───────────────────────────── Confirm modal ───────────────────────────── */

  function askConfirm({ kicker = 'PLEASE CONFIRM', title, message, okText = '确认', danger = false }) {
    if (state.confirm.resolve) {
      state.confirm.resolve(false);
      state.confirm.resolve = null;
    }
    state.confirm.previousFocus = document.activeElement;
    els.confirmKicker.textContent = kicker;
    els.confirmTitle.textContent = title;
    els.confirmMessage.textContent = message;
    els.confirmOkBtn.textContent = okText;
    els.confirmOkBtn.className = danger ? 'btn btn-danger' : 'btn btn-primary';
    els.confirmModal.hidden = false;
    window.setTimeout(() => els.confirmCancelBtn.focus(), 20);
    return new Promise((resolve) => {
      state.confirm.resolve = resolve;
    });
  }

  function resolveConfirm(result) {
    const resolve = state.confirm.resolve;
    state.confirm.resolve = null;
    els.confirmModal.hidden = true;
    const previous = state.confirm.previousFocus;
    state.confirm.previousFocus = null;
    if (previous && typeof previous.focus === 'function' && document.contains(previous)) {
      try {
        previous.focus({ preventScroll: true });
      } catch (error) {
        /* ignore */
      }
    }
    if (resolve) resolve(result);
  }

  /* ───────────────────────────── PNG / rasterizer ───────────────────────────── */

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes, seed = 0) {
    let crc = seed ? seed >>> 0 : 0xffffffff;
    for (let i = 0; i < bytes.length; i += 1) {
      crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function adler32(bytes) {
    let a = 1;
    let b = 0;
    for (let i = 0; i < bytes.length; i += 1) {
      a += bytes[i];
      b += a;
      if ((i & 0x1fff) === 0x1fff) {
        a %= 65521;
        b %= 65521;
      }
    }
    return (((b % 65521) << 16) | (a % 65521)) >>> 0;
  }

  function zlibStore(bytes) {
    const blockSize = 65535;
    const blockCount = Math.max(1, Math.ceil(bytes.length / blockSize));
    const out = new Uint8Array(2 + bytes.length + blockCount * 5 + 4);
    out[0] = 0x78;
    out[1] = 0x01;
    let write = 2;
    let read = 0;
    for (let block = 0; block < blockCount; block += 1) {
      const length = Math.min(blockSize, bytes.length - read);
      out[write] = block === blockCount - 1 ? 0x01 : 0x00;
      out[write + 1] = length & 0xff;
      out[write + 2] = (length >>> 8) & 0xff;
      const inverse = (~length) & 0xffff;
      out[write + 3] = inverse & 0xff;
      out[write + 4] = (inverse >>> 8) & 0xff;
      write += 5;
      out.set(bytes.subarray(read, read + length), write);
      write += length;
      read += length;
    }
    const checksum = adler32(bytes);
    out[write] = (checksum >>> 24) & 0xff;
    out[write + 1] = (checksum >>> 16) & 0xff;
    out[write + 2] = (checksum >>> 8) & 0xff;
    out[write + 3] = checksum & 0xff;
    return out;
  }

  async function deflateZlib(bytes) {
    if (typeof CompressionStream === 'function') {
      try {
        const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
        const compressed = await new Response(stream).arrayBuffer();
        return new Uint8Array(compressed);
      } catch (error) {
        console.warn('[PolyMask] CompressionStream unavailable, using stored zlib', error);
      }
    }
    return zlibStore(bytes);
  }

  function makeChunk(type, data) {
    const typeBytes = new Uint8Array(4);
    for (let i = 0; i < 4; i += 1) typeBytes[i] = type.charCodeAt(i);
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length, false);
    out.set(typeBytes, 4);
    out.set(data, 8);
    const crcInput = out.subarray(4, 8 + data.length);
    view.setUint32(8 + data.length, crc32(crcInput), false);
    return out;
  }

  function rasterizePolygons(polygons, width, height) {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      throw new Error('无效的图片尺寸');
    }
    if (width * height > 300000000) {
      throw new Error('图片尺寸过大，无法在浏览器内生成掩码');
    }
    const stride = width + 1;
    let raw;
    try {
      raw = new Uint8Array(stride * height);
    } catch (error) {
      throw new Error('内存不足，无法分配掩码缓冲区');
    }

    const edgeSets = [];
    for (const polygon of polygons) {
      const points = polygon && Array.isArray(polygon.points) ? polygon.points : [];
      if (points.length < 3) continue;
      const edges = [];
      for (let i = 0; i < points.length; i += 1) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        if (!a || !b) continue;
        if (!Number.isFinite(a.x) || !Number.isFinite(a.y) || !Number.isFinite(b.x) || !Number.isFinite(b.y)) continue;
        if (a.y === b.y) continue;
        edges.push({
          y0: a.y,
          y1: b.y,
          x0: a.x,
          dxdy: (b.x - a.x) / (b.y - a.y),
        });
      }
      if (edges.length >= 2) edgeSets.push(edges);
    }

    if (!edgeSets.length) return raw;

    const hits = [];
    for (let y = 0; y < height; y += 1) {
      const scanY = y + 0.5;
      const rowOffset = y * stride + 1;
      for (const edges of edgeSets) {
        hits.length = 0;
        for (const edge of edges) {
          if ((edge.y0 <= scanY && edge.y1 > scanY) || (edge.y1 <= scanY && edge.y0 > scanY)) {
            hits.push(edge.x0 + (scanY - edge.y0) * edge.dxdy);
          }
        }
        if (hits.length < 2) continue;
        hits.sort((a, b) => a - b);
        for (let i = 0; i + 1 < hits.length; i += 2) {
          const start = Math.max(0, Math.ceil(hits[i] - 0.5));
          const end = Math.min(width, Math.floor(hits[i + 1] - 0.5) + 1);
          if (end > start) raw.fill(255, rowOffset + start, rowOffset + end);
        }
      }
    }
    return raw;
  }

  async function encodeMaskPng(width, height, polygons) {
    const raw = rasterizePolygons(polygons, width, height);
    const compressed = await deflateZlib(raw);
    const ihdr = new Uint8Array(13);
    const view = new DataView(ihdr.buffer);
    view.setUint32(0, width, false);
    view.setUint32(4, height, false);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 0; // grayscale
    ihdr[10] = 0;
    ihdr[11] = 0;
    ihdr[12] = 0;
    const signature = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const parts = [
      signature,
      makeChunk('IHDR', ihdr),
      makeChunk('IDAT', compressed),
      makeChunk('IEND', new Uint8Array(0)),
    ];
    return new Blob(parts, { type: 'image/png' });
  }

  async function generateMask(item, revision) {
    if (!item || !item.image) {
      await loadItemImage(item);
    }
    const width = item.width;
    const height = item.height;
    if (!width || !height) throw new Error('图片尺寸无效');
    const snapshot = item.polygons.map((polygon) => ({
      id: polygon.id,
      points: polygon.points.map((point) => ({ x: point.x, y: point.y })),
    }));
    const blob = await encodeMaskPng(width, height, snapshot);
    if (revision === item.revision) {
      item.maskBlob = blob;
      item.maskRevision = revision;
      item.maskWidth = width;
      item.maskHeight = height;
    }
    return blob;
  }

  async function ensureMask(item, revision) {
    if (
      item.maskBlob
      && item.maskRevision === revision
      && item.maskWidth === item.width
      && item.maskHeight === item.height
    ) {
      return item.maskBlob;
    }
    return generateMask(item, revision);
  }

  /* ───────────────────────────── ZIP writer ───────────────────────────── */

  function dosDateTime(date) {
    const year = clamp(date.getFullYear(), 1980, 2107);
    return {
      time: ((date.getHours() & 31) << 11) | ((date.getMinutes() & 63) << 5) | ((date.getSeconds() & 63) >> 1),
      date: ((year - 1980) << 9) | (((date.getMonth() + 1) & 15) << 5) | (date.getDate() & 31),
    };
  }

  function makeZip(entries) {
    if (entries.length > 65535) throw new Error('文件数量超过 ZIP 上限');
    const encoder = new TextEncoder();
    const stamp = dosDateTime(new Date());
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    for (const entry of entries) {
      const nameBytes = encoder.encode(entry.name);
      const size = entry.size != null ? entry.size : entry.data.byteLength;
      const checksum = entry.crc != null ? entry.crc : crc32(entry.data);
      const local = new Uint8Array(30 + nameBytes.length);
      const localView = new DataView(local.buffer);
      localView.setUint32(0, 0x04034b50, true);
      localView.setUint16(4, 20, true);
      localView.setUint16(6, 0x0800, true);
      localView.setUint16(8, 0, true);
      localView.setUint16(10, stamp.time, true);
      localView.setUint16(12, stamp.date, true);
      localView.setUint32(14, checksum, true);
      localView.setUint32(18, size, true);
      localView.setUint32(22, size, true);
      localView.setUint16(26, nameBytes.length, true);
      localView.setUint16(28, 0, true);
      local.set(nameBytes, 30);
      localParts.push(local, entry.data);

      const central = new Uint8Array(46 + nameBytes.length);
      const centralView = new DataView(central.buffer);
      centralView.setUint32(0, 0x02014b50, true);
      centralView.setUint16(4, 20, true);
      centralView.setUint16(6, 20, true);
      centralView.setUint16(8, 0x0800, true);
      centralView.setUint16(10, 0, true);
      centralView.setUint16(12, stamp.time, true);
      centralView.setUint16(14, stamp.date, true);
      centralView.setUint32(16, checksum, true);
      centralView.setUint32(20, size, true);
      centralView.setUint32(24, size, true);
      centralView.setUint16(28, nameBytes.length, true);
      centralView.setUint16(30, 0, true);
      centralView.setUint16(32, 0, true);
      centralView.setUint16(34, 0, true);
      centralView.setUint16(36, 0, true);
      centralView.setUint32(38, 0, true);
      centralView.setUint32(42, offset, true);
      central.set(nameBytes, 46);
      centralParts.push(central);

      offset += local.length + size;
    }

    const centralOffset = offset;
    let centralSize = 0;
    for (const part of centralParts) centralSize += part.length;

    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);
    endView.setUint32(0, 0x06054b50, true);
    endView.setUint16(4, 0, true);
    endView.setUint16(6, 0, true);
    endView.setUint16(8, entries.length, true);
    endView.setUint16(10, entries.length, true);
    endView.setUint32(12, centralSize, true);
    endView.setUint32(16, centralOffset, true);
    endView.setUint16(20, 0, true);

    return new Blob([...localParts, ...centralParts, end], { type: 'application/zip' });
  }

  /* ───────────────────────────── Export ───────────────────────────── */

  function uniqueMaskNames(items) {
    const used = new Set();
    let collisions = 0;
    const names = items.map((item) => {
      const base = (item.baseName || 'image').replace(/[\\/:*?"<>|]/g, '_') || 'image';
      let candidate = base;
      let suffix = 2;
      while (used.has(candidate.toLowerCase())) {
        candidate = `${base}_${suffix}`;
        suffix += 1;
      }
      if (candidate !== base) collisions += 1;
      used.add(candidate.toLowerCase());
      return `${candidate}.png`;
    });
    return { names, collisions };
  }

  function exportFileName() {
    const now = new Date();
    const pad = (value) => String(value).padStart(2, '0');
    return `polymask_masks_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}.zip`;
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  function resetExportModal(total) {
    els.exportModal.classList.remove('is-done');
    els.exportTitle.textContent = '正在生成掩码';
    els.exportMessage.textContent = '按原始图片尺寸逐张生成 8-bit 单通道灰度 PNG…';
    els.exportProgressBar.style.width = '0%';
    els.exportCurrent.textContent = '准备中…';
    els.exportCount.textContent = `0 / ${total}`;
    els.exportHint.textContent = '掩码和 annotations.json 将打包为 ZIP';
    els.exportCancelBtn.textContent = '取消';
    els.exportCancelBtn.disabled = false;
  }

  function closeExportModal() {
    els.exportModal.hidden = true;
    els.exportModal.classList.remove('is-done');
    state.exporting = false;
    state.exportCancelled = false;
    renderAll();
  }

  function cancelExport() {
    if (els.exportModal.classList.contains('is-done')) {
      closeExportModal();
      return;
    }
    if (!state.exporting || state.exportCancelled) return;
    state.exportCancelled = true;
    els.exportCancelBtn.disabled = true;
    els.exportCancelBtn.textContent = '正在取消…';
    els.exportCurrent.textContent = '正在完成当前图片…';
  }

  async function exportAll() {
    if (state.exporting || state.saving) return;
    if (!state.items.length) {
      showToast('请先导入图片', 'info');
      return;
    }

    const draftItem = state.items.find((item) => item.draft.length > 0);
    if (draftItem) {
      showToast(`“${draftItem.name}”还有未闭合的多边形，请先闭合或取消`, 'error', 4200);
      await selectItem(draftItem.id);
      return;
    }

    state.exporting = true;
    state.exportCancelled = false;
    const total = state.items.length;
    resetExportModal(total);
    els.exportModal.hidden = false;
    renderProgress();
    renderControls();

    const { names: maskNames, collisions } = uniqueMaskNames(state.items);
    const entries = [];
    const records = [];
    const usedNames = new Set();

    try {
      for (let index = 0; index < state.items.length; index += 1) {
        if (state.exportCancelled) break;
        const item = state.items[index];
        els.exportCurrent.textContent = item.name;
        els.exportCount.textContent = `${index} / ${total}`;

        if (!item.image) {
          item.status = 'loading';
          item.error = null;
          if (state.currentId === item.id) renderAll();
          try {
            await loadItemImage(item);
            item.status = 'ready';
          } catch (error) {
            item.status = 'error';
            item.error = error instanceof Error ? error.message : String(error);
            if (state.currentId === item.id) renderAll();
            throw new Error(`无法读取 ${item.name}：${item.error}`);
          }
        }
        if (state.exportCancelled) break;

        const revision = item.revision;
        const maskBlob = await ensureMask(item, revision);
        const buffer = new Uint8Array(await maskBlob.arrayBuffer());
        const maskName = maskNames[index];
        usedNames.add(maskName.toLowerCase());
        entries.push({
          name: maskName,
          data: buffer,
          size: buffer.byteLength,
          crc: crc32(buffer),
        });
        records.push({
          image: item.relativePath,
          mask: maskName,
          width: item.width,
          height: item.height,
          defectCount: item.polygons.length,
          polygons: item.polygons.map((polygon) => polygon.points.map((point) => [round2(point.x), round2(point.y)])),
        });

        item.savedRevision = revision;
        item.savedDefectCount = item.polygons.length;
        item.maskRevision = revision;
        item.maskWidth = item.width;
        item.maskHeight = item.height;
        item.maskBlob = maskBlob;
        item.status = 'ready';

        const percent = ((index + 1) / total) * 100;
        els.exportProgressBar.style.width = `${percent}%`;
        els.exportCount.textContent = `${index + 1} / ${total}`;
        renderProgress();
        await tick();
      }

      if (state.exportCancelled) {
        closeExportModal();
        showToast('已取消导出，没有下载 ZIP', 'info');
        return;
      }

      els.exportCurrent.textContent = '正在打包 ZIP…';
      els.exportHint.textContent = '正在写入 annotations.json 与 ZIP 目录…';
      const payload = {
        format: 'polymask-annotations',
        version: 1,
        generatedAt: new Date().toISOString(),
        coordinateSystem: 'image pixels, origin at top-left',
        imageCount: records.length,
        maskFormat: {
          type: '8-bit grayscale PNG',
          foreground: 255,
          background: 0,
        },
        images: records,
      };
      const jsonBytes = new TextEncoder().encode(JSON.stringify(payload, null, 2));
      entries.push({
        name: 'annotations.json',
        data: jsonBytes,
        size: jsonBytes.byteLength,
        crc: crc32(jsonBytes),
      });

      await tick();
      const zip = makeZip(entries);
      if (state.exportCancelled) {
        closeExportModal();
        showToast('已取消导出，没有下载 ZIP', 'info');
        return;
      }
      downloadBlob(zip, exportFileName());

      els.exportProgressBar.style.width = '100%';
      els.exportCount.textContent = `${total} / ${total}`;
      els.exportCurrent.textContent = 'ZIP 已开始下载';
      els.exportTitle.textContent = '导出完成';
      els.exportMessage.textContent = `已打包 ${total} 张 8-bit 灰度掩码与 annotations.json，下载即将开始。`;
      els.exportHint.textContent = collisions
        ? `检测到 ${collisions} 个同名主文件名，已自动添加序号避免覆盖`
        : '掩码与原始图片同名，缺陷为 255，背景为 0';
      els.exportModal.classList.add('is-done');
      els.exportCancelBtn.textContent = '关闭';
      els.exportCancelBtn.disabled = false;
      renderAll();
      showToast(`已导出 ${total} 张掩码${collisions ? '（部分文件已自动重命名）' : ''}`, 'success', 4200);
    } catch (error) {
      console.error('[PolyMask] export failed', error);
      els.exportModal.hidden = true;
      state.exporting = false;
      state.exportCancelled = false;
      renderAll();
      showToast(`导出失败：${error instanceof Error ? error.message : String(error)}`, 'error', 6000);
    }
  }

  /* ───────────────────────────── Binding / init ───────────────────────────── */

  function bindEvents() {
    const openFiles = () => els.fileInput.click();
    const openFolder = () => els.folderInput.click();

    els.importFilesBtn.addEventListener('click', openFiles);
    els.emptyFilesBtn.addEventListener('click', openFiles);
    els.importFolderBtn.addEventListener('click', openFolder);
    els.emptyFolderBtn.addEventListener('click', openFolder);

    els.fileInput.addEventListener('change', async (event) => {
      const infos = filesToInfos(event.target.files);
      event.target.value = '';
      await importFileInfos(infos);
    });

    els.folderInput.addEventListener('change', async (event) => {
      const infos = filesToInfos(event.target.files);
      event.target.value = '';
      await importFileInfos(infos);
    });

    els.imageList.addEventListener('click', (event) => {
      const card = event.target.closest('.image-card');
      if (!card) return;
      const remove = event.target.closest('.card-remove');
      if (remove) {
        event.stopPropagation();
        removeItem(card.dataset.id);
        return;
      }
      selectItem(card.dataset.id);
    });

    els.imageList.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const card = event.target.closest('.image-card');
      if (!card) return;
      event.preventDefault();
      selectItem(card.dataset.id);
    });

    for (const button of document.querySelectorAll('.filter-btn')) {
      button.addEventListener('click', () => {
        const filter = button.dataset.filter || 'all';
        if (state.filter === filter) return;
        state.filter = filter;
        for (const entry of document.querySelectorAll('.filter-btn')) {
          const active = entry === button;
          entry.classList.toggle('is-active', active);
          entry.setAttribute('aria-selected', active ? 'true' : 'false');
        }
        renderImageList(true);
      });
    }

    els.zoomOutBtn.addEventListener('click', () => {
      const { width, height } = resizeCanvas();
      zoomAt(width / 2, height / 2, 1 / 1.25);
    });
    els.zoomInBtn.addEventListener('click', () => {
      const { width, height } = resizeCanvas();
      zoomAt(width / 2, height / 2, 1.25);
    });
    els.zoomLabel.addEventListener('click', resetZoom);
    els.fitBtn.addEventListener('click', fitView);

    els.saveBtn.addEventListener('click', () => saveCurrent(false));
    els.saveNextBtn.addEventListener('click', () => saveCurrent(true));
    els.exportBtn.addEventListener('click', exportAll);

    els.polygonList.addEventListener('click', (event) => {
      const del = event.target.closest('[data-delete-polygon]');
      if (del) {
        event.stopPropagation();
        const item = getCurrentItem();
        if (!item || state.saving || state.exporting) return;
        const id = Number(del.dataset.deletePolygon);
        const polygon = item.polygons.find((entry) => entry.id === id);
        if (!polygon) return;
        item.polygons = item.polygons.filter((entry) => entry.id !== id);
        if (item.selectedPolygonId === id) item.selectedPolygonId = null;
        markItemChanged(item);
        renderAll();
        showToast('已删除多边形', 'info', 1800);
        return;
      }
      const main = event.target.closest('.poly-item-main');
      if (!main) return;
      const id = Number(main.dataset.polygonId);
      const item = getCurrentItem();
      if (!item) return;
      item.selectedPolygonId = item.selectedPolygonId === id ? null : id;
      renderAll();
    });

    els.draftCloseBtn.addEventListener('click', closeDraft);
    els.draftCancelBtn.addEventListener('click', cancelDraft);
    els.clearPolygonsBtn.addEventListener('click', clearPolygons);

    els.inspectorToggleBtn?.addEventListener('click', () => {
      setInspectorOpen(!els.inspector.classList.contains('is-open'));
    });
    els.inspectorCloseBtn?.addEventListener('click', () => setInspectorOpen(false));

    els.stageErrorRemoveBtn?.addEventListener('click', () => {
      const item = getCurrentItem();
      if (item) removeItem(item.id);
    });

    els.confirmCancelBtn.addEventListener('click', () => resolveConfirm(false));
    els.confirmOkBtn.addEventListener('click', () => resolveConfirm(true));
    els.confirmModal.addEventListener('click', (event) => {
      if (event.target === els.confirmModal) resolveConfirm(false);
    });

    els.exportCancelBtn.addEventListener('click', () => {
      if (els.exportModal.classList.contains('is-done')) closeExportModal();
      else cancelExport();
    });

    els.canvas.addEventListener('pointerdown', onPointerDown);
    els.canvas.addEventListener('pointermove', onPointerMove);
    els.canvas.addEventListener('pointerup', onPointerUp);
    els.canvas.addEventListener('pointercancel', onPointerCancel);
    els.canvas.addEventListener('pointerleave', onPointerLeave);
    els.canvas.addEventListener('click', onClick);
    els.canvas.addEventListener('dblclick', onDoubleClick);
    els.canvas.addEventListener('contextmenu', onContextMenu);
    els.canvas.addEventListener('wheel', onWheel, { passive: false });

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', () => {
      state.spaceDown = false;
      if (!state.pan) els.canvas.style.cursor = 'crosshair';
    });

    let dragDepth = 0;
    const hasFiles = (event) => {
      const types = event.dataTransfer && event.dataTransfer.types;
      if (!types) return false;
      return Array.from(types).includes('Files');
    };

    window.addEventListener('dragenter', (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dragDepth += 1;
      els.dragOverlay.hidden = false;
    });

    window.addEventListener('dragover', (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    });

    window.addEventListener('dragleave', (event) => {
      if (!hasFiles(event)) return;
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) els.dragOverlay.hidden = true;
    });

    window.addEventListener('drop', async (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dragDepth = 0;
      els.dragOverlay.hidden = true;
      showToast('正在读取拖入的文件…', 'info', 1600);
      try {
        const infos = await infosFromDataTransfer(event.dataTransfer);
        await importFileInfos(infos);
      } catch (error) {
        console.error('[PolyMask] drop import failed', error);
        showToast('读取拖入的文件失败，请尝试用“添加图片”按钮', 'error', 4200);
      }
    });

    window.addEventListener('dragover', (event) => {
      if (!hasFiles(event)) event.preventDefault();
    });
    window.addEventListener('drop', (event) => {
      if (!hasFiles(event)) event.preventDefault();
    });

    const resize = () => {
      resizeCanvas();
      if (state.fitMode) fitView();
      else renderCanvas();
    };
    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(resize);
      observer.observe(els.stage);
    }
    window.addEventListener('resize', resize);
  }

  function init() {
    bindEvents();
    resizeCanvas();
    renderAll();
  }

  init();
})();
