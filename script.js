// MediaPipe 手部 21 点连接关系（用于绘制骨架）
const HAND_CONNECTIONS = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[0,9],[9,10],[10,11],[11,12],[0,13],[13,14],[14,15],[15,16],[0,17],[17,18],[18,19],[19,20],[5,9],[9,13],[13,17]];

// 全局变量
let hands;
let camera;
let video;
let canvas;
let ctx;
let svg;
let previewVideo;
let previewCanvas;
let previewCtx;
let previewCamera = null;
let isDrawing = false;
let currentPath = [];
let allPaths = [];
let fadingPathData = null;
let fadeIntervalId = null;
let userText = '';
let isCameraActive = false;
let actionBtn = null;
let backgroundMode = 'camera';
let backgroundImage = null;
let textPathMode = 'after';   // 'after' 先画线后出字 | 'realtime' 画线即出字
let pinchMissCount = 0;
const MAX_PINCH_MISS = 5;

// 动画参数配置（与 index 控件默认值一致）
let animationParams = {
    speed: 1.8,
    duration: 3.0,
    fontSize: 60,
    textColor: '#ffffff',
    strokeColor: '#f0a90f',
    strokeWidth: 5.0,
    repeatCount: 1,
    fadeInDuration: 0.2,
    fadeOutDuration: 0.2
};

// 初始化
function init() {
    video = document.getElementById('video');
    canvas = document.getElementById('canvas');
    ctx = canvas.getContext('2d');
    svg = document.getElementById('textPath');
    const videoContainer = document.getElementById('videoContainer');
    const defaultImage = document.getElementById('defaultImage');

    previewVideo = document.getElementById('previewVideo');
    previewCanvas = document.getElementById('previewCanvas');
    previewCtx = previewCanvas.getContext('2d');
    const cameraPreviewContainer = document.getElementById('cameraPreviewContainer');
    const statusPreviewWrapper = document.querySelector('.status-preview-wrapper');

    const textInput = document.getElementById('textInput');
    actionBtn = document.getElementById('actionBtn');
    backgroundImage = document.getElementById('backgroundImage');

    initBackgroundMode();
    startCameraPreview();

    window.updateActionButton = function() {
        if (!actionBtn) return;
        if (isDrawing) {
            actionBtn.textContent = '清除';
            actionBtn.className = 'btn-primary btn-full-width';
        } else if (isCameraActive) {
            actionBtn.textContent = '清除';
            actionBtn.className = 'btn-primary btn-full-width';
        } else {
            actionBtn.textContent = '开始';
            actionBtn.className = 'btn-primary btn-full-width';
        }
    };

    actionBtn.addEventListener('click', async () => {
        if (isDrawing || isCameraActive) {
            isCameraActive = false;
            isDrawing = false;
            currentPath = [];
            allPaths = [];
            clearCanvas();
            userText = '';
            textInput.value = '';
            textInput.disabled = false;
            updateStatus('请先输入文案，然后点击"开始"按钮激活摄像头');
            if (typeof window.updateActionButton === 'function') window.updateActionButton();
        } else {
            const text = textInput.value.trim();
            if (!text) { updateStatus('请输入文案后再点击"开始"'); return; }
            if (text.length > 15) { updateStatus('文案长度不能超过15个字'); return; }

            userText = text;
            textInput.disabled = true;

            try {
                actionBtn.disabled = true;
                actionBtn.textContent = '启动中...';
                updateStatus('正在激活手势识别...');

                if (!hands) {
                    hands = new Hands({
                        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
                    });
                    hands.setOptions({
                        maxNumHands: 1,
                        modelComplexity: 1,
                        minDetectionConfidence: 0.7,
                        minTrackingConfidence: 0.7
                    });
                    hands.onResults(onResults);
                }

                // 确保当前模式对应的摄像头已启动（切换选项后可能尚未就绪，导致 onFrame 不触发）
                if (backgroundMode === 'camera') {
                    const videoReady = video && video.readyState >= 2;
                    if (!camera || !videoReady) {
                        await startCameraPreview();
                    }
                } else {
                    const previewReady = previewVideo && previewVideo.readyState >= 2;
                    if (!previewCamera || !previewReady) {
                        await startPreviewCamera();
                    }
                }

                isCameraActive = true;
                if (backgroundMode === 'image') {
                    updateStatus('手势识别已激活！请在左侧摄像头窗口进行手势交互，轨迹将显示在右侧图片上');
                } else {
                    updateStatus('手势识别已激活！请将手放在摄像头前，双指捏合开始绘制轨迹');
                }
                if (typeof window.updateActionButton === 'function') window.updateActionButton();
                actionBtn.disabled = false;
            } catch (error) {
                console.error('激活手势识别失败:', error);
                updateStatus('激活手势识别失败，请重试');
                isCameraActive = false;
                textInput.disabled = false;
                if (typeof window.updateActionButton === 'function') window.updateActionButton();
                actionBtn.disabled = false;
            }
        }
    });

    // 右上角 tao 图标点击 -> Toast「功能建设中」
    const taoIcon = document.getElementById('taoIcon');
    const toastEl = document.getElementById('toast');
    if (taoIcon && toastEl) {
        taoIcon.addEventListener('click', () => {
            toastEl.classList.add('show');
            setTimeout(() => toastEl.classList.remove('show'), 2000);
        });
    }

    const textPathModeRadios = document.querySelectorAll('input[name="textPathMode"]');
    textPathModeRadios.forEach(radio => {
        radio.addEventListener('change', (e) => { textPathMode = e.target.value; });
    });

    function initBackgroundMode() {
        const modeRadios = document.querySelectorAll('input[name="backgroundMode"]');
        const uploadBtn = document.getElementById('uploadBtn');
        const imageUpload = document.getElementById('imageUpload');

        modeRadios.forEach(radio => {
            radio.addEventListener('change', (e) => {
                backgroundMode = e.target.value;
                if (backgroundMode === 'image') {
                    uploadBtn.style.display = 'inline-block';
                    cameraPreviewContainer.style.display = 'block';
                    if (statusPreviewWrapper) statusPreviewWrapper.classList.add('image-mode');
                    startPreviewCamera();
                    video.style.display = 'none';
                    defaultImage.style.display = 'none';
                    backgroundImage.style.display = 'block';
                    updateStatus('请上传图片作为背景，然后在左侧摄像头窗口进行手势交互');
                    setTimeout(() => { if (window.updateControlPanelHeight) window.updateControlPanelHeight(); }, 100);
                } else {
                    uploadBtn.style.display = 'none';
                    cameraPreviewContainer.style.display = 'none';
                    if (statusPreviewWrapper) statusPreviewWrapper.classList.remove('image-mode');
                    stopPreviewCamera();
                    backgroundImage.style.display = 'none';
                    if (!camera || !video.videoWidth) {
                        defaultImage.style.display = 'block';
                        video.style.display = 'none';
                    } else {
                        defaultImage.style.display = 'none';
                        video.style.display = 'block';
                    }
                    startCameraPreview();
                    setTimeout(() => { if (window.updateControlPanelHeight) window.updateControlPanelHeight(); }, 100);
                }
                isCameraActive = false;
                clearCanvas();
                if (typeof window.updateActionButton === 'function') window.updateActionButton();
            });
        });

        uploadBtn.addEventListener('click', () => imageUpload.click());
        imageUpload.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                backgroundImage.src = ev.target.result;
                backgroundImage.onload = () => {
                    const cw = videoContainer.offsetWidth, ch = videoContainer.offsetHeight;
                    canvas.width = cw; canvas.height = ch;
                    svg.setAttribute('width', cw); svg.setAttribute('height', ch);
                    svg.setAttribute('viewBox', `0 0 ${cw} ${ch}`);
                    svg.setAttribute('preserveAspectRatio', 'none');
                    const ia = backgroundImage.naturalWidth / backgroundImage.naturalHeight;
                    const ca = cw / ch;
                    let sx = 0, sy = 0, sw = backgroundImage.naturalWidth, sh = backgroundImage.naturalHeight;
                    if (ia > ca) { sw = backgroundImage.naturalHeight * ca; sx = (backgroundImage.naturalWidth - sw) / 2; }
                    else { sh = backgroundImage.naturalWidth / ca; sy = (backgroundImage.naturalHeight - sh) / 2; }
                    ctx.drawImage(backgroundImage, sx, sy, sw, sh, 0, 0, cw, ch);
                    updateStatus('图片已加载，请先输入文案，然后点击"开始"按钮激活手势识别');
                };
            };
            reader.readAsDataURL(file);
        });
    }

    async function startCameraPreview() {
        try {
            videoContainer.style.display = 'block';
            if (backgroundMode === 'image') return;
            if (camera) { try { camera.stop(); } catch (e) {} camera = null; }

            camera = new Camera(video, {
                onFrame: async () => {
                    if (isCameraActive && hands && backgroundMode === 'camera') await hands.send({ image: video });
                },
                width: 1280,
                height: 720
            });
            await camera.start();

            video.addEventListener('loadedmetadata', () => {
                const cw = videoContainer.offsetWidth, ch = videoContainer.offsetHeight;
                canvas.width = cw; canvas.height = ch;
                svg.setAttribute('width', cw); svg.setAttribute('height', ch);
                svg.setAttribute('viewBox', `0 0 ${cw} ${ch}`);
                svg.setAttribute('preserveAspectRatio', 'none');
                defaultImage.style.display = 'none';
                video.style.display = 'block';
            });
            updateStatus('摄像头已启动，请先输入文案，然后点击"开始"按钮激活手势识别');
        } catch (error) {
            console.error('启动摄像头预览失败:', error);
            let msg = '启动摄像头失败';
            if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') msg = '摄像头权限被拒绝，请在浏览器设置中允许访问摄像头';
            else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') msg = '未找到摄像头设备';
            else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') msg = '摄像头被其他应用占用';
            else msg = `启动摄像头失败: ${error.message || error.name}`;
            updateStatus(msg);
            defaultImage.style.display = 'block';
            video.style.display = 'none';
            camera = null;
        }
    }
}

// MediaPipe Hands 结果处理
function onResults(results) {
    // 绘制背景
    if (backgroundMode === 'image' && backgroundImage && backgroundImage.complete) {
        const cw = canvas.width, ch = canvas.height;
        const ia = backgroundImage.naturalWidth / backgroundImage.naturalHeight, ca = cw / ch;
        let sx = 0, sy = 0, sw = backgroundImage.naturalWidth, sh = backgroundImage.naturalHeight;
        if (ia > ca) { sw = backgroundImage.naturalHeight * ca; sx = (backgroundImage.naturalWidth - sw) / 2; }
        else { sh = backgroundImage.naturalWidth / ca; sy = (backgroundImage.naturalHeight - sh) / 2; }
        ctx.drawImage(backgroundImage, sx, sy, sw, sh, 0, 0, cw, ch);
    } else if (backgroundMode === 'camera') {
        const cw = canvas.width, ch = canvas.height;
        const va = video.videoWidth / video.videoHeight, ca = cw / ch;
        let sx = 0, sy = 0, sw = video.videoWidth, sh = video.videoHeight;
        if (va > ca) { sw = video.videoHeight * ca; sx = (video.videoWidth - sw) / 2; }
        else { sh = video.videoWidth / ca; sy = (video.videoHeight - sh) / 2; }
        ctx.drawImage(video, sx, sy, sw, sh, 0, 0, cw, ch);
    }

    // 若有正在渐隐的路径，在主画布上绘制（画线即出字模式下不展示白线）
    if (textPathMode !== 'realtime' && fadingPathData && fadingPathData.path && fadingPathData.path.length >= 2) {
        drawPathOnCanvas(fadingPathData.path, { opacity: fadingPathData.opacity });
    }

    // 手势骨架：图片模式在预览 canvas，摄像头模式在主 ctx
    if (backgroundMode === 'image' && previewCtx && previewCanvas) {
        previewCtx.save();
        previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
        previewCtx.drawImage(results.image, 0, 0, previewCanvas.width, previewCanvas.height);
        if (results.multiHandLandmarks) {
            for (const lm of results.multiHandLandmarks) {
                drawHandConnectionsForCanvas(previewCtx, lm, HAND_CONNECTIONS);
                drawHandLandmarksForCanvas(previewCtx, lm, { color: '#FF0000', lineWidth: 2 });
                drawPinchPoints(previewCtx, lm);
            }
        }
        previewCtx.restore();
    } else if (backgroundMode === 'camera' && results.multiHandLandmarks) {
        for (const lm of results.multiHandLandmarks) {
            drawHandConnectionsForCanvas(ctx, lm, HAND_CONNECTIONS);
            drawHandLandmarksForCanvas(ctx, lm, { color: '#FF0000', lineWidth: 2 });
            drawPinchPoints(ctx, lm);
        }
    }

    // 捏合检测（仅第一只手）
    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        const lm = results.multiHandLandmarks[0];
        const d = Math.hypot(lm[4].x - lm[8].x, lm[4].y - lm[8].y);
        const pinchThreshold = 0.08;

        if (d < pinchThreshold) {
            pinchMissCount = 0;
            if (!isDrawing) {
                if (fadeIntervalId) { clearInterval(fadeIntervalId); fadeIntervalId = null; }
                fadingPathData = null;
                removeRealtimeTextPath();
                isDrawing = true;
                currentPath = [];
                if (typeof window.updateActionButton === 'function') window.updateActionButton();
            }
            const center = { x: (lm[4].x + lm[8].x) / 2, y: (lm[4].y + lm[8].y) / 2 };
            const pt = mapCoordinatesToCanvas(center.x, center.y);
            const minDist = 0.01;
            if (currentPath.length === 0 ||
                Math.abs(currentPath[currentPath.length - 1].x - pt.x) > minDist ||
                Math.abs(currentPath[currentPath.length - 1].y - pt.y) > minDist) {
                currentPath.push(pt);
                drawCurrentPath();
                if (textPathMode === 'realtime' && userText && currentPath.length >= 2) {
                    updateRealtimeTextPath(currentPath);
                }
            }
        } else {
            pinchMissCount++;
            if (isDrawing && pinchMissCount >= MAX_PINCH_MISS) {
                isDrawing = false;
                pinchMissCount = 0;
                if (currentPath.length > 0) {
                    const smoothed = smoothPath(currentPath);
                    if (textPathMode === 'realtime' && userText) {
                        updateRealtimeTextPath(smoothed, true);
                    } else {
                        removeRealtimeTextPath();
                        if (userText) generateTextPathAnimation(smoothed, userText);
                        fadeOutPath(smoothed);
                    }
                } else {
                    removeRealtimeTextPath();
                }
                currentPath = [];
                if (typeof window.updateActionButton === 'function') window.updateActionButton();
            }
        }
    } else {
        if (isDrawing) {
            pinchMissCount++;
            if (pinchMissCount >= MAX_PINCH_MISS) {
                isDrawing = false;
                pinchMissCount = 0;
                if (currentPath.length > 0) {
                    const smoothed = smoothPath(currentPath);
                    if (textPathMode === 'realtime' && userText) {
                        updateRealtimeTextPath(smoothed, true);
                    } else {
                        removeRealtimeTextPath();
                        if (userText) generateTextPathAnimation(smoothed, userText);
                        fadeOutPath(smoothed);
                    }
                } else {
                    removeRealtimeTextPath();
                }
                currentPath = [];
                if (typeof window.updateActionButton === 'function') window.updateActionButton();
            }
        }
    }
}

function mapCoordinatesToCanvas(nx, ny) {
    return { x: nx * canvas.width, y: ny * canvas.height };
}

async function startPreviewCamera() {
    try {
        if (previewCamera) { try { previewCamera.stop(); } catch (e) {} previewCamera = null; }
        previewCamera = new Camera(previewVideo, {
            onFrame: async () => {
                if (isCameraActive && hands && backgroundMode === 'image') await hands.send({ image: previewVideo });
            },
            width: 640,
            height: 480
        });
        await previewCamera.start();
        previewVideo.addEventListener('loadedmetadata', () => {
            previewCanvas.width = previewVideo.videoWidth;
            previewCanvas.height = previewVideo.videoHeight;
        });
    } catch (error) {
        console.error('启动预览摄像头失败:', error);
        let msg = '启动预览摄像头失败';
        if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') msg = '摄像头权限被拒绝';
        else if (error.name === 'NotFoundError') msg = '未找到摄像头';
        else if (error.name === 'NotReadableError') msg = '摄像头被占用';
        else msg = `启动失败: ${error.message || error.name}`;
        updateStatus(msg);
        previewCamera = null;
    }
}

function stopPreviewCamera() {
    if (previewCamera) { try { previewCamera.stop(); } catch (e) {} previewCamera = null; }
}

function drawCurrentPath() {
    if (backgroundMode === 'image' && backgroundImage && backgroundImage.complete) {
        const cw = canvas.width, ch = canvas.height;
        const ia = backgroundImage.naturalWidth / backgroundImage.naturalHeight, ca = cw / ch;
        let sx = 0, sy = 0, sw = backgroundImage.naturalWidth, sh = backgroundImage.naturalHeight;
        if (ia > ca) { sw = backgroundImage.naturalHeight * ca; sx = (backgroundImage.naturalWidth - sw) / 2; }
        else { sh = backgroundImage.naturalWidth / ca; sy = (backgroundImage.naturalHeight - sh) / 2; }
        ctx.drawImage(backgroundImage, sx, sy, sw, sh, 0, 0, cw, ch);
    } else if (backgroundMode === 'camera') {
        const cw = canvas.width, ch = canvas.height;
        const va = video.videoWidth / video.videoHeight, ca = cw / ch;
        let sx = 0, sy = 0, sw = video.videoWidth, sh = video.videoHeight;
        if (va > ca) { sw = video.videoHeight * ca; sx = (video.videoWidth - sw) / 2; }
        else { sh = video.videoWidth / ca; sy = (video.videoHeight - sh) / 2; }
        ctx.drawImage(video, sx, sy, sw, sh, 0, 0, cw, ch);
    }
    // 画线即出字模式下不展示白色用户轨迹线
    if (textPathMode !== 'realtime' && currentPath.length > 1) drawPathOnCanvas(currentPath, { opacity: 1 });
}

function smoothPath(path) {
    if (path.length < 3) return path;
    let s = [path[0]];
    for (let i = 1; i < path.length - 1; i++) {
        const p = path[i - 1], c = path[i], n = path[i + 1];
        s.push({ x: p.x * 0.25 + c.x * 0.5 + n.x * 0.25, y: p.y * 0.25 + c.y * 0.5 + n.y * 0.25 });
    }
    s.push(path[path.length - 1]);
    if (s.length >= 5) {
        const d = [s[0]];
        for (let i = 1; i < s.length - 1; i++) {
            const p = s[i - 1], c = s[i], n = s[i + 1];
            d.push({ x: p.x * 0.25 + c.x * 0.5 + n.x * 0.25, y: p.y * 0.25 + c.y * 0.5 + n.y * 0.25 });
        }
        d.push(s[s.length - 1]);
        return d;
    }
    return s;
}

function drawPathOnCanvas(path, opts = {}) {
    if (path.length < 2) return;
    const sp = smoothPath(path);
    ctx.save();
    ctx.strokeStyle = `rgba(255, 255, 255, ${opts.opacity ?? 1})`;
    ctx.lineWidth = opts.width || 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    if (sp.length >= 2) {
        ctx.moveTo(sp[0].x, sp[0].y);
        if (sp.length === 2) ctx.lineTo(sp[1].x, sp[1].y);
        else if (sp.length === 3) ctx.quadraticCurveTo(sp[1].x, sp[1].y, sp[2].x, sp[2].y);
        else {
            for (let i = 1; i < sp.length - 1; i++) {
                const c = sp[i], n = sp[i + 1];
                ctx.quadraticCurveTo(c.x, c.y, (c.x + n.x) / 2, (c.y + n.y) / 2);
            }
            const a = sp[sp.length - 2], b = sp[sp.length - 1];
            ctx.quadraticCurveTo(a.x, a.y, b.x, b.y);
        }
    }
    ctx.stroke();
    ctx.restore();
}

function fadeOutPath(path) {
    if (!path || path.length < 2) return;
    if (fadeIntervalId) { clearInterval(fadeIntervalId); fadeIntervalId = null; }
    fadingPathData = { path: path, opacity: 1 };
    fadeIntervalId = setInterval(() => {
        fadingPathData.opacity -= 0.05;
        if (fadingPathData.opacity <= 0) {
            fadingPathData = null;
            clearInterval(fadeIntervalId);
            fadeIntervalId = null;
        }
    }, 20);
}

function clearCanvas() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (backgroundMode === 'image' && backgroundImage && backgroundImage.complete) {
        const cw = canvas.width, ch = canvas.height;
        const ia = backgroundImage.naturalWidth / backgroundImage.naturalHeight, ca = cw / ch;
        let sx = 0, sy = 0, sw = backgroundImage.naturalWidth, sh = backgroundImage.naturalHeight;
        if (ia > ca) { sw = backgroundImage.naturalHeight * ca; sx = (backgroundImage.naturalWidth - sw) / 2; }
        else { sh = backgroundImage.naturalWidth / ca; sy = (backgroundImage.naturalHeight - sh) / 2; }
        ctx.drawImage(backgroundImage, sx, sy, sw, sh, 0, 0, cw, ch);
    }
    currentPath = [];
    allPaths = [];
    if (fadeIntervalId) { clearInterval(fadeIntervalId); fadeIntervalId = null; }
    fadingPathData = null;
    removeRealtimeTextPath();
    const t = svg.querySelector('text'), p = svg.querySelector('path[id^="text-path-"]');
    if (t) t.remove();
    if (p) p.remove();
}

// 根据路径走向返回用于文字展示的路径（保证文字为正、不颠倒）
function getPathForText(path) {
    if (path.length < 2) return path;
    const p0 = path[0], pn = path[path.length - 1];
    const dx = pn.x - p0.x, dy = pn.y - p0.y;
    if (Math.abs(dx) >= Math.abs(dy)) {
        if (dx > 0) return path.slice().reverse();
    } else {
        if (dy < 0) return path.slice().reverse();
    }
    return path;
}

function removeRealtimeTextPath() {
    const defs = svg.querySelector('defs#realtime-defs');
    const wrapper = svg.querySelector('g#realtime-wrapper');
    if (defs) defs.remove();
    if (wrapper) wrapper.remove();
}

// 在路径末尾沿方向延伸一段，使总长至少为 needLength（画布坐标）
function extendPathForText(path, needLength) {
    if (path.length < 2 || needLength <= 0) return path;
    const last = path[path.length - 1], prev = path[path.length - 2];
    const dx = last.x - prev.x, dy = last.y - prev.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return path;
    const newPoint = { x: last.x + (dx / len) * needLength, y: last.y + (dy / len) * needLength };
    return path.concat([newPoint]);
}

// 截取路径从起点开始、总长约 targetLength 的一段，保证文字从第一个字起完整排布
function trimPathToLength(path, targetLength) {
    if (path.length < 2 || targetLength <= 0) return path;
    let len = 0;
    for (let i = 1; i < path.length; i++) {
        const seg = Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
        if (len + seg >= targetLength) {
            const t = (targetLength - len) / seg;
            const end = {
                x: path[i - 1].x + t * (path[i].x - path[i - 1].x),
                y: path[i - 1].y + t * (path[i].y - path[i - 1].y)
            };
            return path.slice(0, i).concat([end]);
        }
        len += seg;
    }
    return path;
}

function measureTextWidth(text) {
    try {
        const tmp = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        tmp.setAttribute('font-family', '造字工房乐真体');
        tmp.setAttribute('font-size', animationParams.fontSize);
        tmp.textContent = text;
        tmp.setAttribute('visibility', 'hidden');
        tmp.setAttribute('x', '0');
        tmp.setAttribute('y', '0');
        svg.appendChild(tmp);
        const w = tmp.getBBox().width;
        svg.removeChild(tmp);
        return w;
    } catch (e) {
        return text.length * animationParams.fontSize * 0.6;
    }
}

function updateRealtimeTextPath(path, isFinal) {
    if (path.length < 2 || !userText) return;
    removeRealtimeTextPath();
    const ns = 'http://www.w3.org/2000/svg';
    const xlink = 'http://www.w3.org/1999/xlink';
    const textWidth = measureTextWidth(userText);
    const pathDrawn = path.slice();
    const pathElTemp = document.createElementNS(ns, 'path');
    pathElTemp.setAttribute('d', pathToSVGPath(pathDrawn));
    pathElTemp.setAttribute('fill', 'none');
    svg.appendChild(pathElTemp);
    const drawnLength = pathElTemp.getTotalLength();
    svg.removeChild(pathElTemp);
    let pathForLayout;
    if (drawnLength >= textWidth) {
        pathForLayout = trimPathToLength(pathDrawn, textWidth);
    } else {
        pathForLayout = extendPathForText(pathDrawn, textWidth - drawnLength);
    }
    const pathD = pathToSVGPath(pathForLayout);
    const drawnPathD = pathToSVGPath(pathDrawn);

    const cw = canvas.width, ch = canvas.height;
    const defs = document.createElementNS(ns, 'defs');
    defs.setAttribute('id', 'realtime-defs');
    const mask = document.createElementNS(ns, 'mask');
    mask.setAttribute('id', 'realtime-mask');
    mask.setAttribute('maskUnits', 'userSpaceOnUse');
    mask.setAttribute('maskContentUnits', 'userSpaceOnUse');
    const maskRect = document.createElementNS(ns, 'rect');
    maskRect.setAttribute('x', '0');
    maskRect.setAttribute('y', '0');
    maskRect.setAttribute('width', String(cw));
    maskRect.setAttribute('height', String(ch));
    maskRect.setAttribute('fill', 'black');
    mask.appendChild(maskRect);
    const maskPath = document.createElementNS(ns, 'path');
    maskPath.setAttribute('d', drawnPathD);
    maskPath.setAttribute('fill', 'none');
    maskPath.setAttribute('stroke', 'white');
    maskPath.setAttribute('stroke-width', String(Math.max(animationParams.fontSize * 1.2, 40)));
    maskPath.setAttribute('stroke-linecap', 'round');
    maskPath.setAttribute('stroke-linejoin', 'round');
    mask.appendChild(maskPath);
    defs.appendChild(mask);
    svg.appendChild(defs);

    const wrapper = document.createElementNS(ns, 'g');
    wrapper.setAttribute('id', 'realtime-wrapper');
    if (!isFinal) wrapper.setAttribute('mask', 'url(#realtime-mask)');

    const pathEl = document.createElementNS(ns, 'path');
    pathEl.setAttribute('id', 'text-path-realtime');
    pathEl.setAttribute('d', pathD);
    pathEl.setAttribute('fill', 'none');
    pathEl.setAttribute('stroke', 'none');
    wrapper.appendChild(pathEl);

    const textEl = document.createElementNS(ns, 'text');
    textEl.setAttribute('id', 'text-realtime');
    textEl.setAttribute('font-family', '造字工房乐真体');
    textEl.setAttribute('font-size', animationParams.fontSize);
    textEl.setAttribute('fill', animationParams.textColor);
    textEl.setAttribute('stroke', animationParams.strokeColor);
    textEl.setAttribute('stroke-width', animationParams.strokeWidth);
    textEl.setAttribute('paint-order', 'stroke fill');
    textEl.setAttribute('dominant-baseline', 'central');
    textEl.setAttribute('text-anchor', 'start');
    const textPathEl = document.createElementNS(ns, 'textPath');
    textPathEl.setAttributeNS(xlink, 'href', '#text-path-realtime');
    textPathEl.setAttribute('startOffset', '0');
    textPathEl.textContent = userText;
    textEl.appendChild(textPathEl);
    wrapper.appendChild(textEl);
    svg.appendChild(wrapper);
}

function generateTextPathAnimation(path, text) {
    if (path.length < 2 || !text) return;

    removeRealtimeTextPath();
    const pathToUse = getPathForText(path);

    const t = svg.querySelector('text'), p = svg.querySelector('path[id^="text-path-"]');
    if (t) t.remove();
    if (p) p.remove();

    const pathId = `text-path-${Date.now()}`;
    const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    pathEl.setAttribute('id', pathId);
    pathEl.setAttribute('d', pathToSVGPath(pathToUse));
    pathEl.setAttribute('fill', 'none');
    pathEl.setAttribute('stroke', 'none');
    svg.appendChild(pathEl);

    setTimeout(() => {
        const pathLength = pathEl.getTotalLength();
        const textEl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        textEl.setAttribute('font-family', '造字工房乐真体');
        textEl.setAttribute('font-size', animationParams.fontSize);
        textEl.setAttribute('fill', animationParams.textColor);
        textEl.setAttribute('stroke', animationParams.strokeColor);
        textEl.setAttribute('stroke-width', animationParams.strokeWidth);
        textEl.setAttribute('paint-order', 'stroke fill');
        textEl.setAttribute('dominant-baseline', 'central');
        textEl.setAttribute('text-anchor', 'middle');

        const textPathEl = document.createElementNS('http://www.w3.org/2000/svg', 'textPath');
        textPathEl.setAttributeNS('http://www.w3.org/1999/xlink', 'href', `#${pathId}`);
        textPathEl.setAttribute('startOffset', '0');
        textPathEl.textContent = text;
        textEl.appendChild(textPathEl);
        textEl.setAttribute('opacity', '0');
        svg.appendChild(textEl);

        setTimeout(() => {
            let textWidth = 0;
            try {
                const tmp = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                tmp.setAttribute('font-family', '造字工房乐真体');
                tmp.setAttribute('font-size', animationParams.fontSize);
                tmp.textContent = text;
                tmp.setAttribute('visibility', 'hidden');
                tmp.setAttribute('x', '0');
                tmp.setAttribute('y', '0');
                svg.appendChild(tmp);
                textWidth = tmp.getBBox().width || (animationParams.fontSize * text.length * 0.6);
                svg.removeChild(tmp);
            } catch (e) {
                textWidth = animationParams.fontSize * text.length * 0.6;
            }

            const totalDistance = pathLength + textWidth;

            const fadeIn = document.createElementNS('http://www.w3.org/2000/svg', 'animate');
            fadeIn.setAttribute('attributeName', 'opacity');
            fadeIn.setAttribute('from', '0');
            fadeIn.setAttribute('to', '1');
            fadeIn.setAttribute('dur', `${animationParams.fadeInDuration}s`);
            fadeIn.setAttribute('fill', 'freeze');
            textEl.appendChild(fadeIn);

            let animDur = animationParams.repeatCount === 0
                ? totalDistance / (animationParams.speed * 100)
                : animationParams.duration / animationParams.speed;

            const anim = document.createElementNS('http://www.w3.org/2000/svg', 'animate');
            anim.setAttribute('attributeName', 'startOffset');
            anim.setAttribute('from', '0');
            anim.setAttribute('to', String(totalDistance));
            anim.setAttribute('dur', `${animDur}s`);
            anim.setAttribute('repeatCount', animationParams.repeatCount === 0 ? 'indefinite' : animationParams.repeatCount);
            anim.setAttribute('fill', 'freeze');
            textPathEl.appendChild(anim);

            if (animationParams.repeatCount !== 0) {
                const fadeOut = document.createElementNS('http://www.w3.org/2000/svg', 'animate');
                fadeOut.setAttribute('attributeName', 'opacity');
                fadeOut.setAttribute('from', '1');
                fadeOut.setAttribute('to', '0');
                fadeOut.setAttribute('dur', `${animationParams.fadeOutDuration}s`);
                fadeOut.setAttribute('begin', `${animDur - animationParams.fadeOutDuration}s`);
                fadeOut.setAttribute('fill', 'freeze');
                textEl.appendChild(fadeOut);
            }

            fadeIn.beginElement();
            anim.beginElement();
        }, 50);
    }, 10);
}

function pathToSVGPath(path) {
    if (path.length === 0) return '';
    const mp = path.map(p => ({ x: canvas.width - p.x, y: p.y }));
    let d = `M ${mp[0].x} ${mp[0].y}`;
    for (let i = 1; i < mp.length; i++) d += ` L ${mp[i].x} ${mp[i].y}`;
    return d;
}

function drawHandConnectionsForCanvas(ctx, landmarks, connections) {
    ctx.save();
    ctx.strokeStyle = '#00FF00';
    ctx.lineWidth = 2;
    ctx.beginPath();
    const isPreview = (ctx === previewCtx);
    const W = isPreview ? previewCanvas.width : canvas.width;
    const H = isPreview ? previewCanvas.height : canvas.height;
    for (const [a, b] of connections) {
        const s = landmarks[a], e = landmarks[b];
        ctx.moveTo(s.x * W, s.y * H);
        ctx.lineTo(e.x * W, e.y * H);
    }
    ctx.stroke();
    ctx.restore();
}

function drawHandLandmarksForCanvas(ctx, landmarks, opts = {}) {
    ctx.save();
    ctx.fillStyle = opts.color || '#FF0000';
    const isPreview = (ctx === previewCtx);
    const W = isPreview ? previewCanvas.width : canvas.width;
    const H = isPreview ? previewCanvas.height : canvas.height;
    for (let i = 0; i < landmarks.length; i++) {
        if (i === 4 || i === 8) continue;
        const p = landmarks[i];
        ctx.beginPath();
        ctx.arc(p.x * W, p.y * H, opts.radius || 3, 0, 2 * Math.PI);
        ctx.fill();
    }
    ctx.restore();
}

function drawPinchPoints(ctx, landmarks) {
    if (landmarks.length < 9) return;
    const isPreview = (ctx === previewCtx);
    const W = isPreview ? previewCanvas.width : canvas.width;
    const H = isPreview ? previewCanvas.height : canvas.height;
    const [tx, ty] = [landmarks[4].x * W, landmarks[4].y * H];
    const [ix, iy] = [landmarks[8].x * W, landmarks[8].y * H];
    ctx.save();
    ctx.fillStyle = '#FFFF00';
    ctx.strokeStyle = '#FF0000';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(tx, ty, 8, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#00FFFF';
    ctx.strokeStyle = '#0000FF';
    ctx.beginPath();
    ctx.arc(ix, iy, 8, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
}

// 当提示包含该文案时，在操作提示模块末尾显示 hand.gif
const STATUS_SHOW_HAND_GIF = '双指捏合开始绘制轨迹';

function updateStatus(msg) {
    const el = document.getElementById('statusText');
    const gifEl = document.getElementById('statusHandGif');
    if (el) el.textContent = msg;
    if (gifEl) {
        gifEl.style.display = (msg && msg.includes(STATUS_SHOW_HAND_GIF)) ? 'inline-block' : 'none';
    }
}

// 初始化控制面板
function initControlPanel() {
    function updateControlPanelHeight() {
        const cp = document.getElementById('controlPanel');
        const sec = document.querySelector('.control-section');
        const st = document.querySelector('.status');
        const vc = document.getElementById('videoContainer');
        const pw = document.querySelector('.preview-wrapper');
        if (!cp || !sec || !st || !vc) return;
        const sh = sec.offsetHeight, gap = 20;
        let total;
        if (backgroundMode === 'image' && pw) total = pw.offsetHeight + gap + vc.offsetHeight;
        else total = st.offsetHeight + gap + vc.offsetHeight;
        cp.style.height = cp.style.maxHeight = `${total - sh - gap}px`;
    }
    window.updateControlPanelHeight = updateControlPanelHeight;
    setTimeout(updateControlPanelHeight, 100);
    window.addEventListener('resize', updateControlPanelHeight);

    const speedSlider = document.getElementById('animSpeed');
    const speedValue = document.getElementById('speedValue');
    speedSlider.addEventListener('input', (e) => {
        animationParams.speed = parseFloat(e.target.value);
        speedValue.textContent = animationParams.speed.toFixed(1) + 'x';
    });

    const durationGroup = document.getElementById('durationGroup');
    const durationSlider = document.getElementById('animDuration');
    const durationValue = document.getElementById('durationValue');
    durationSlider.addEventListener('input', (e) => {
        animationParams.duration = parseFloat(e.target.value);
        durationValue.textContent = animationParams.duration.toFixed(1);
    });

    const fontSizeSlider = document.getElementById('fontSize');
    const fontSizeValue = document.getElementById('fontSizeValue');
    fontSizeSlider.addEventListener('input', (e) => {
        animationParams.fontSize = parseInt(e.target.value);
        fontSizeValue.textContent = animationParams.fontSize;
    });

    const textColorInput = document.getElementById('textColor');
    const textColorValue = document.getElementById('textColorValue');
    textColorInput.addEventListener('input', (e) => {
        animationParams.textColor = e.target.value;
        textColorValue.textContent = animationParams.textColor;
    });

    const strokeColorInput = document.getElementById('strokeColor');
    const strokeColorValue = document.getElementById('strokeColorValue');
    strokeColorInput.addEventListener('input', (e) => {
        animationParams.strokeColor = e.target.value;
        strokeColorValue.textContent = animationParams.strokeColor;
    });

    const strokeWidthSlider = document.getElementById('strokeWidth');
    const strokeWidthValue = document.getElementById('strokeWidthValue');
    strokeWidthSlider.addEventListener('input', (e) => {
        animationParams.strokeWidth = parseFloat(e.target.value);
        strokeWidthValue.textContent = animationParams.strokeWidth.toFixed(1);
    });

    const repeatCountSelect = document.getElementById('repeatCount');
    repeatCountSelect.addEventListener('change', (e) => {
        animationParams.repeatCount = parseInt(e.target.value);
        durationGroup.style.display = animationParams.repeatCount === 0 ? 'none' : 'flex';
    });

    const fadeInSlider = document.getElementById('fadeInDuration');
    const fadeInValue = document.getElementById('fadeInValue');
    fadeInSlider.addEventListener('input', (e) => {
        animationParams.fadeInDuration = parseFloat(e.target.value);
        fadeInValue.textContent = animationParams.fadeInDuration.toFixed(1);
    });

    const fadeOutSlider = document.getElementById('fadeOutDuration');
    const fadeOutValue = document.getElementById('fadeOutValue');
    fadeOutSlider.addEventListener('input', (e) => {
        animationParams.fadeOutDuration = parseFloat(e.target.value);
        fadeOutValue.textContent = animationParams.fadeOutDuration.toFixed(1);
    });

    const resetBtn = document.getElementById('resetBtn');
    resetBtn.addEventListener('click', () => {
        animationParams = {
            speed: 1.8,
            duration: 3.0,
            fontSize: 60,
            textColor: '#ffffff',
            strokeColor: '#f0a90f',
            strokeWidth: 5.0,
            repeatCount: 1,
            fadeInDuration: 0.2,
            fadeOutDuration: 0.2
        };
        speedSlider.value = animationParams.speed;
        speedValue.textContent = animationParams.speed.toFixed(1) + 'x';
        durationSlider.value = animationParams.duration;
        durationValue.textContent = animationParams.duration.toFixed(1);
        fontSizeSlider.value = animationParams.fontSize;
        fontSizeValue.textContent = animationParams.fontSize;
        textColorInput.value = animationParams.textColor;
        textColorValue.textContent = animationParams.textColor;
        strokeColorInput.value = animationParams.strokeColor;
        strokeColorValue.textContent = animationParams.strokeColor;
        strokeWidthSlider.value = animationParams.strokeWidth;
        strokeWidthValue.textContent = animationParams.strokeWidth.toFixed(1);
        repeatCountSelect.value = animationParams.repeatCount;
        durationGroup.style.display = animationParams.repeatCount === 0 ? 'none' : 'flex';
        fadeInSlider.value = animationParams.fadeInDuration;
        fadeInValue.textContent = animationParams.fadeInDuration.toFixed(1);
        fadeOutSlider.value = animationParams.fadeOutDuration;
        fadeOutValue.textContent = animationParams.fadeOutDuration.toFixed(1);
    });

    document.getElementById('applyBtn').addEventListener('click', () => {
        const btn = document.getElementById('applyBtn');
        const orig = btn.textContent;
        btn.textContent = '已应用！';
        btn.style.background = '#28a745';
        setTimeout(() => { btn.textContent = orig; btn.style.background = ''; }, 1500);
    });
}

window.addEventListener('DOMContentLoaded', () => {
    init();
    initControlPanel();
    initSaveImage();
});

/**
 * ============================================================
 * 截图保存功能
 * ============================================================
 * 功能：截取右下角视窗区域（canvas + SVG 文字），保存为 PNG 图片
 * 
 * 实现方式：
 * 1. 将主 canvas 内容绘制到临时 canvas
 * 2. 将 SVG 序列化为图像并叠加到临时 canvas
 * 3. 导出为 PNG 并触发浏览器下载
 * 
 * 无需引入第三方库，使用原生 Canvas API 实现
 * 兼容 Chrome、Edge、Safari 等主流浏览器
 * ============================================================
 */

// ========== 可配置参数（方便后续修改）==========
const SCREENSHOT_CONFIG = {
    // 下载文件名（不含扩展名）
    fileName: '视窗_截图',
    // 图片格式：'image/png' 或 'image/jpeg'
    imageFormat: 'image/png',
    // JPEG 质量（0-1，仅 format 为 jpeg 时有效）
    imageQuality: 0.95
};

/**
 * 初始化截图保存功能
 * 绑定保存按钮点击事件
 */
function initSaveImage() {
    const saveBtn = document.getElementById('saveImageBtn');
    if (!saveBtn) return;

    saveBtn.addEventListener('click', async () => {
        try {
            // 禁用按钮，防止重复点击
            saveBtn.disabled = true;
            saveBtn.textContent = '保存中...';

            // 执行截图
            await captureAndSaveViewport();

            // 恢复按钮状态
            saveBtn.textContent = '保存成功！';
            setTimeout(() => {
                saveBtn.textContent = '保存图片';
                saveBtn.disabled = false;
            }, 1500);

        } catch (error) {
            console.error('截图保存失败:', error);
            saveBtn.textContent = '保存失败';
            setTimeout(() => {
                saveBtn.textContent = '保存图片';
                saveBtn.disabled = false;
            }, 1500);
        }
    });
}

/**
 * 截取视窗区域并保存
 * 将 canvas（背景+轨迹）和 SVG（文字）合成为一张图片
 * 摄像头模式下对画面做水平翻转，使保存的图片不被镜像（与页面 CSS scaleX(-1) 抵消）
 */
async function captureAndSaveViewport() {
    const sourceCanvas = document.getElementById('canvas');
    const svgElement = document.getElementById('textPath');

    if (!sourceCanvas) {
        throw new Error('找不到 canvas 元素');
    }

    const width = sourceCanvas.width;
    const height = sourceCanvas.height;

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = width;
    tempCanvas.height = height;
    const tempCtx = tempCanvas.getContext('2d');

    // 是否需要对截图做水平翻转（摄像头模式下页面用 CSS 镜像显示，保存时翻转回来）
    const flipHorizontal = backgroundMode === 'camera';

    // 步骤1：绘制主 canvas 内容
    if (flipHorizontal) {
        tempCtx.save();
        tempCtx.translate(width, 0);
        tempCtx.scale(-1, 1);
        tempCtx.drawImage(sourceCanvas, 0, 0, width, height);
        tempCtx.restore();
    } else {
        tempCtx.drawImage(sourceCanvas, 0, 0, width, height);
    }

    // 步骤2：绘制文字层（用 canvas 直接绘制，使用页面已加载字体，不翻转以与已翻转的画面对齐）
    if (svgElement && svgElement.innerHTML.trim()) {
        drawTextLayerFromSVG(svgElement, tempCtx, width, height);
    }

    downloadCanvas(tempCanvas, SCREENSHOT_CONFIG.fileName);
}

/**
 * 从 SVG 读取 path 与 text，用 canvas 沿路径绘制文字（使用页面已加载字体，截图不丢字）
 * 不翻转文字层，与已水平翻转的摄像头画面对齐
 * @param {SVGElement} svgElement - 视窗内的 SVG 元素
 * @param {CanvasRenderingContext2D} ctx - 目标 canvas 2D 上下文
 * @param {number} width - 画布宽
 * @param {number} height - 画布高
 */
function drawTextLayerFromSVG(svgElement, ctx, width, height) {
    const textEl = svgElement.querySelector('text');
    const pathEl = svgElement.querySelector('path[id^="text-path-"]');
    if (!textEl || !pathEl) return;

    const textPathEl = textEl.querySelector('textPath');
    if (!textPathEl) return;

    const pathD = pathEl.getAttribute('d');
    const text = (textPathEl.textContent || '').trim();
    if (!pathD || !text) return;

    const fontSize = parseInt(textEl.getAttribute('font-size'), 10) || animationParams.fontSize;
    const fontFamily = textEl.getAttribute('font-family') || '造字工房乐真体';
    const fill = textEl.getAttribute('fill') || animationParams.textColor;
    const stroke = textEl.getAttribute('stroke') || animationParams.strokeColor;
    const strokeWidth = parseFloat(textEl.getAttribute('stroke-width')) || animationParams.strokeWidth;
    const paintOrder = textEl.getAttribute('paint-order') || 'stroke fill';

    ctx.save();
    ctx.font = `${fontSize}px ${fontFamily}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';

    const pathLen = pathEl.getTotalLength();
    const charWidths = [];
    for (let i = 0; i < text.length; i++) {
        charWidths.push(ctx.measureText(text[i]).width);
    }
    const drawStrokeFirst = paintOrder === 'stroke fill';
    let offset = 0;

    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const w = charWidths[i];
        const pos = offset + w / 2;
        if (pos < 0 || pos > pathLen) {
            offset += w;
            continue;
        }
        const pt = pathEl.getPointAtLength(pos);
        const nextPos = Math.min(pos + 2, pathLen);
        const nextPt = pathEl.getPointAtLength(nextPos);
        let angle = Math.atan2(nextPt.y - pt.y, nextPt.x - pt.x);
        if (angle > Math.PI / 2 || angle < -Math.PI / 2) angle += Math.PI;

        ctx.save();
        ctx.translate(pt.x, pt.y);
        ctx.rotate(angle);
        ctx.fillStyle = fill;
        ctx.strokeStyle = stroke;
        ctx.lineWidth = strokeWidth;

        if (drawStrokeFirst) {
            ctx.strokeText(char, 0, 0);
            ctx.fillText(char, 0, 0);
        } else {
            ctx.fillText(char, 0, 0);
            ctx.strokeText(char, 0, 0);
        }
        ctx.restore();
        offset += w;
    }
    ctx.restore();
}

/**
 * 将 Canvas 导出为图片并触发下载
 * @param {HTMLCanvasElement} canvas - 要导出的 canvas 元素
 * @param {string} fileName - 下载文件名（不含扩展名）
 */
function downloadCanvas(canvas, fileName) {
    // 根据格式确定扩展名
    const format = SCREENSHOT_CONFIG.imageFormat;
    const ext = format === 'image/jpeg' ? 'jpg' : 'png';
    const fullFileName = `${fileName}.${ext}`;

    // 导出为 data URL
    let dataUrl;
    if (format === 'image/jpeg') {
        dataUrl = canvas.toDataURL(format, SCREENSHOT_CONFIG.imageQuality);
    } else {
        dataUrl = canvas.toDataURL(format);
    }

    // 创建下载链接并触发下载
    const link = document.createElement('a');
    link.download = fullFileName;
    link.href = dataUrl;
    
    // 添加到 DOM、触发点击、然后移除
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
