import React, { useState, useRef, useEffect } from 'react';
import { Upload, Download, ZoomIn, Scissors, Printer, ArrowLeft, LayoutGrid, Share, Minus, Plus } from 'lucide-react';

export default function App() {
  // --- Состояния ---
  const [step, setStep] = useState('upload');
  const [imageSrc, setImageSrc] = useState(null);

  // Метаданные изображения (натуральные размеры)
  const [imgMeta, setImgMeta] = useState({ w: 0, h: 0 });

  // Размеры кропа
  const [widthMM, setWidthMM] = useState('35');
  const [heightMM, setHeightMM] = useState('45');

  // Настройки редактора
  const [zoom, setZoom] = useState(1); // 1.0 = "Cover" (заполнение рамки)
  const [pan, setPan] = useState({ x: 0, y: 0 });

  // Для превью (размеры контейнера на экране)
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });

  // Результат и Печать
  const [croppedImage, setCroppedImage] = useState(null);
  const [paperSize, setPaperSize] = useState('A4');
  const [paperWidth, setPaperWidth] = useState(210);
  const [paperHeight, setPaperHeight] = useState(297);
  const [pageMargin, setPageMargin] = useState(5);
  const [photoGap, setPhotoGap] = useState(2);
  const [printSheetImage, setPrintSheetImage] = useState(null);
  const [photosCount, setPhotosCount] = useState(0);

  const [isProcessing, setIsProcessing] = useState(false);

  // Ссылки
  const containerRef = useRef(null);
  const startPanRef = useRef({ x: 0, y: 0 });
  const isDraggingRef = useRef(false);

  const PIXELS_PER_MM = 11.81;

  // --- Загрузка ---
  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
            setImgMeta({ w: img.naturalWidth, h: img.naturalHeight });
            setImageSrc(event.target.result);
            setStep('crop');
            setZoom(1); // Сбрасываем на "идеальное заполнение"
            setPan({ x: 0, y: 0 });
            setCroppedImage(null);
        };
        img.src = event.target.result;
      };
      reader.readAsDataURL(file);
    }
  };

  // --- Resize Observer для контейнера превью ---
  // Нам нужно знать точные размеры div-контейнера на экране, чтобы правильно считать baseScale
  useEffect(() => {
    if (step === 'crop' && containerRef.current) {
        const updateSize = () => {
            if(containerRef.current) {
                const rect = containerRef.current.getBoundingClientRect();
                setContainerSize({ w: rect.width, h: rect.height });
            }
        };

        // Initial
        updateSize();

        // Observer
        const resizeObserver = new ResizeObserver(() => updateSize());
        resizeObserver.observe(containerRef.current);

        return () => resizeObserver.disconnect();
    }
  }, [step, widthMM, heightMM]);

  // --- Вычисление "Базового Масштаба" (Cover Logic) ---
  // Возвращает множитель масштаба, при котором фото полностью закрывает область (как object-fit: cover)
  const getBaseScale = (targetW, targetH, imgW, imgH) => {
    if (!imgW || !imgH || !targetW || !targetH) return 1;
    const scaleX = targetW / imgW;
    const scaleY = targetH / imgH;
    return Math.max(scaleX, scaleY);
  };

  // --- Обработчики движения (Pan) ---
  const handleStart = (clientX, clientY) => {
    isDraggingRef.current = true;
    startPanRef.current = { x: clientX - pan.x, y: clientY - pan.y };
  };

  const handleMove = (clientX, clientY) => {
    if (!isDraggingRef.current) return;
    setPan({
      x: clientX - startPanRef.current.x,
      y: clientY - startPanRef.current.y
    });
  };

  const handleEnd = () => isDraggingRef.current = false;

  const pointerEvents = {
    onMouseDown: (e) => handleStart(e.clientX, e.clientY),
    onMouseMove: (e) => handleMove(e.clientX, e.clientY),
    onMouseUp: handleEnd,
    onMouseLeave: handleEnd,
    onTouchStart: (e) => handleStart(e.touches[0].clientX, e.touches[0].clientY),
    onTouchMove: (e) => handleMove(e.touches[0].clientX, e.touches[0].clientY),
    onTouchEnd: handleEnd,
  };

  // --- Zoom Controls (0.5x ... 3.0x относительно Cover) ---
  const MIN_ZOOM = 0.5;
  const MAX_ZOOM = 3.0;
  const ZOOM_STEP = 0.05;

  const handleZoomChange = (e) => setZoom(parseFloat(e.target.value));
  const zoomIn = () => setZoom(z => Math.min(MAX_ZOOM, z + 0.1));
  const zoomOut = () => setZoom(z => Math.max(MIN_ZOOM, z - 0.1));

  // --- Генерация ---
  const generateSingleImage = () => {
    setIsProcessing(true);
    const wMM = Number(widthMM) || 35;
    const hMM = Number(heightMM) || 45;

    setTimeout(() => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const img = new Image();

      img.onload = () => {
        // Реальные размеры целевого изображения
        const targetWidth = wMM * PIXELS_PER_MM;
        const targetHeight = hMM * PIXELS_PER_MM;

        canvas.width = targetWidth;
        canvas.height = targetHeight;

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // 1. Считаем базовый масштаб для Канваса (чтобы фото заполнило канвас)
        const baseScaleCanvas = getBaseScale(targetWidth, targetHeight, img.naturalWidth, img.naturalHeight);

        // 2. Итоговый масштаб = База * Пользовательский зум
        const finalScale = baseScaleCanvas * zoom;

        // 3. Вычисляем размеры для рисования
        const drawW = img.naturalWidth * finalScale;
        const drawH = img.naturalHeight * finalScale;

        // 4. Координаты
        // Важный момент: pan.x / pan.y были в экранных пикселях контейнера.
        // Нам нужно перевести смещение (pan) из системы координат "Превью" в систему "Канвас".
        // Коэффициент перевода: отношение ширины канваса к ширине превью.

        const previewToCanvasRatio = targetWidth / containerSize.w;

        const offsetX = pan.x * previewToCanvasRatio;
        const offsetY = pan.y * previewToCanvasRatio;

        // Центрирование + Смещение
        const drawX = (targetWidth - drawW) / 2 + offsetX;
        const drawY = (targetHeight - drawH) / 2 + offsetY;

        ctx.drawImage(img, drawX, drawY, drawW, drawH);

        setCroppedImage(canvas.toDataURL('image/jpeg', 0.95));
        setStep('result');
        setIsProcessing(false);
      };
      img.src = imageSrc;
    }, 100);
  };

  // --- Styles for Render ---
  // Вычисляем стиль для картинки в превью "на лету"
  const getImgStyle = () => {
    // Базовый масштаб для текущего контейнера превью
    const baseScalePreview = getBaseScale(containerSize.w, containerSize.h, imgMeta.w, imgMeta.h);
    const finalScale = baseScalePreview * zoom;

    return {
        width: imgMeta.w * finalScale,
        height: imgMeta.h * finalScale,
        transform: `translate(${pan.x}px, ${pan.y}px)`, // translate работает уже с размерами элемента
        maxWidth: 'none',
        position: 'absolute',
        top: '50%',
        left: '50%',
        marginLeft: -(imgMeta.w * finalScale) / 2, // Центрируем через margin, так как translate занят pan'ом
        marginTop: -(imgMeta.h * finalScale) / 2,
    };
  };

  // --- Print Sheet Logic (Same as before) ---
  useEffect(() => {
    if (step === 'print' && croppedImage) {
      generatePrintSheet();
    }
  }, [step, paperWidth, paperHeight, pageMargin, photoGap, croppedImage]);

  const generatePrintSheet = () => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();
    img.onload = () => {
      const sheetW = paperWidth * PIXELS_PER_MM;
      const sheetH = paperHeight * PIXELS_PER_MM;
      canvas.width = sheetW; canvas.height = sheetH;
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, sheetW, sheetH);

      const photoW = img.width; const photoH = img.height;
      const marginPx = pageMargin * PIXELS_PER_MM;
      const gapPx = photoGap * PIXELS_PER_MM;
      const availableW = sheetW - (marginPx * 2);
      const availableH = sheetH - (marginPx * 2);

      const cols = Math.floor((availableW + gapPx) / (photoW + gapPx));
      const rows = Math.floor((availableH + gapPx) / (photoH + gapPx));
      setPhotosCount(Math.max(0, cols * rows));

      let startY = marginPx;
      for (let r = 0; r < rows; r++) {
        let startX = marginPx;
        for (let c = 0; c < cols; c++) {
          ctx.drawImage(img, startX, startY, photoW, photoH);
          ctx.strokeStyle = '#cccccc'; ctx.lineWidth = 1;
          ctx.strokeRect(startX, startY, photoW, photoH);
          startX += photoW + gapPx;
        }
        startY += photoH + gapPx;
      }
      setPrintSheetImage(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.src = croppedImage;
  };

  const handleDownload = async (dataUrl, filename) => {
    if (!dataUrl) return;
    if (navigator.share && navigator.canShare) {
        try {
            const blob = await (await fetch(dataUrl)).blob();
            const file = new File([blob], filename, { type: 'image/jpeg' });
            if (navigator.canShare({ files: [file] })) {
                await navigator.share({ files: [file], title: filename });
                return;
            }
        } catch (e) {}
    }
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDimChange = (setter) => (e) => {
    const val = e.target.value;
    setter(val === '' ? '' : parseFloat(val));
  };

  const handlePaperPreset = (preset) => {
    setPaperSize(preset);
    if (preset === 'A4') { setPaperWidth(210); setPaperHeight(297); }
    if (preset === '10x15') { setPaperWidth(100); setPaperHeight(150); }
    if (preset === 'A6') { setPaperWidth(105); setPaperHeight(148); }
  };

  const getPreviewContainerStyle = () => {
    const w = Number(widthMM) || 35;
    const h = Number(heightMM) || 45;
    const ratio = w / h;
    return {
      width: `min(100%, calc(55vh * ${ratio}))`,
      aspectRatio: `${w}/${h}`,
    };
  };

  return (
    <div className="min-h-screen bg-neutral-900 text-white font-sans flex flex-col items-center">
      <header className="w-full p-4 bg-neutral-800 border-b border-neutral-700 flex items-center justify-between sticky top-0 z-30 shadow-md h-16">
        <h1 className="text-lg font-bold flex items-center gap-2">
          <Scissors className="w-5 h-5 text-emerald-400" />
          <span className="hidden sm:inline">Photo Docs</span>
        </h1>
        <div className="flex items-center gap-2">
          {step !== 'upload' && step !== 'crop' && (
            <button onClick={() => step === 'print' ? setStep('result') : setStep('crop')} className="text-sm text-neutral-400 hover:text-white px-2 py-1 flex items-center gap-1">
              <ArrowLeft size={14}/> Назад
            </button>
          )}
          {step === 'crop' && imageSrc && (
             <button onClick={() => { setImageSrc(null); setStep('upload'); }} className="text-sm text-neutral-400 hover:text-white px-2 py-1">Сброс</button>
          )}
        </div>
      </header>

      <main className="flex-1 w-full max-w-2xl p-4 flex flex-col gap-4">
        {step === 'upload' && (
          <div className="flex-1 flex flex-col items-center justify-center border-2 border-dashed border-neutral-700 rounded-2xl p-8 bg-neutral-800/50 my-auto animate-in fade-in zoom-in-95">
            <Upload className="w-16 h-16 text-neutral-600 mb-6" />
            <h2 className="text-xl font-semibold mb-2">Фото на документы</h2>
            <p className="text-neutral-400 text-center mb-8 max-w-xs">Загрузите фото для обработки</p>
            <label className="bg-emerald-500 hover:bg-emerald-600 text-white font-bold py-4 px-8 rounded-xl cursor-pointer transition-all shadow-lg active:scale-95 flex items-center gap-2">
              <Upload size={20}/> Загрузить фото
              <input type="file" accept="image/*" onChange={handleFileChange} className="hidden" />
            </label>
          </div>
        )}

        {step === 'crop' && (
          <>
            <div className="bg-neutral-800 p-4 rounded-xl border border-neutral-700 shadow-lg">
              <div className="flex gap-4 items-end">
                <div className="flex-1">
                  <label className="text-[10px] uppercase text-neutral-500 font-bold mb-1 block">Ширина (мм)</label>
                  <input type="number" value={widthMM} onChange={handleDimChange(setWidthMM)} className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-xl font-mono text-white focus:border-emerald-500 outline-none" placeholder="35"/>
                </div>
                <div className="flex-1">
                  <label className="text-[10px] uppercase text-neutral-500 font-bold mb-1 block">Высота (мм)</label>
                  <input type="number" value={heightMM} onChange={handleDimChange(setHeightMM)} className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-xl font-mono text-white focus:border-emerald-500 outline-none" placeholder="45"/>
                </div>
              </div>
            </div>

            <div className="flex-1 flex items-center justify-center min-h-0 bg-neutral-950/30 rounded-xl overflow-hidden border border-neutral-800 relative">
               <div className="absolute top-2 left-2 z-20 bg-black/60 backdrop-blur px-2 py-1 rounded text-[10px] text-white/70 pointer-events-none">Перемещение</div>
                <div
                    ref={containerRef}
                    style={getPreviewContainerStyle()}
                    className="relative overflow-hidden bg-neutral-800 cursor-move touch-none ring-4 ring-neutral-900 shadow-2xl"
                    {...pointerEvents}
                >
                    {/* Сетка */}
                    <div className="absolute inset-0 z-20 pointer-events-none opacity-20 border border-white/40">
                        <div className="w-full h-1/3 border-b border-white/40"></div>
                        <div className="w-full h-1/3 border-b border-white/40"></div>
                    </div>
                    <div className="absolute inset-0 z-20 pointer-events-none opacity-20 flex">
                        <div className="h-full w-1/3 border-r border-white/40"></div>
                        <div className="h-full w-1/3 border-r border-white/40"></div>
                    </div>

                    {/* Изображение */}
                    <img
                      src={imageSrc}
                      alt="Edit"
                      draggable={false}
                      style={getImgStyle()}
                    />
                </div>
            </div>

            <div className="bg-neutral-800 p-5 rounded-t-2xl border-t border-neutral-700 shadow-2xl space-y-5">
              <div className="space-y-2">
                <div className="flex justify-between text-xs font-bold text-neutral-400 uppercase tracking-wide">
                  <span className="flex items-center gap-1"><ZoomIn size={12}/> Zoom (Заполнение)</span>
                  <span>{(zoom * 100).toFixed(0)}%</span>
                </div>

                <div className="flex items-center gap-3">
                    <button onClick={zoomOut} className="w-10 h-10 flex items-center justify-center rounded-full bg-neutral-700 hover:bg-neutral-600 active:scale-95 transition-all"><Minus size={18}/></button>
                    <input type="range" min={MIN_ZOOM} max={MAX_ZOOM} step={ZOOM_STEP} value={zoom} onChange={handleZoomChange} className="flex-1 h-3 bg-neutral-700 rounded-full appearance-none cursor-pointer accent-emerald-500"/>
                    <button onClick={zoomIn} className="w-10 h-10 flex items-center justify-center rounded-full bg-neutral-700 hover:bg-neutral-600 active:scale-95 transition-all"><Plus size={18}/></button>
                </div>
              </div>

              <button onClick={generateSingleImage} disabled={isProcessing} className="w-full py-4 bg-emerald-500 hover:bg-emerald-600 disabled:bg-neutral-600 text-white font-bold rounded-xl shadow-lg active:scale-[0.98] flex items-center justify-center gap-2">
                {isProcessing ? 'Обработка...' : 'Далее'}
              </button>
            </div>
          </>
        )}

        {step === 'result' && croppedImage && (
           <div className="flex flex-col items-center gap-6 animate-in slide-in-from-right duration-300 py-4">
             <div className="bg-white p-2 rounded shadow-lg transform rotate-1">
                <img src={croppedImage} alt="Single" className="max-h-[35vh] shadow-inner" />
             </div>
             <div className="w-full space-y-3">
               <button onClick={() => setStep('print')} className="w-full py-4 bg-emerald-500 hover:bg-emerald-600 text-white font-bold rounded-xl shadow-lg flex items-center justify-center gap-2 active:scale-[0.98]">
                 <LayoutGrid size={20} /> Подготовить для печати
               </button>
               <button onClick={() => handleDownload(croppedImage, `photo-${widthMM}x${heightMM}.jpg`)} className="w-full py-4 bg-neutral-800 hover:bg-neutral-700 text-white font-medium rounded-xl border border-neutral-600 flex items-center justify-center gap-2 active:scale-[0.98]">
                 <Share size={20} /> Скачать одно фото
               </button>
             </div>
           </div>
        )}

        {step === 'print' && (
          <div className="flex flex-col gap-4 animate-in slide-in-from-right duration-300 pb-20">
            <div className="bg-neutral-800 rounded-xl p-4 border border-neutral-700 space-y-4">
               <div className="flex items-center gap-2 text-emerald-400 font-bold mb-2"><Printer size={18} /> Настройки листа</div>
               <div className="flex bg-neutral-900 p-1 rounded-lg">
                 {['A4', '10x15', 'A6'].map(p => (
                   <button key={p} onClick={() => handlePaperPreset(p)} className={`flex-1 py-1.5 text-sm rounded-md transition-colors ${paperSize === p ? 'bg-neutral-700 font-bold shadow' : 'text-neutral-400 hover:text-white'}`}>{p}</button>
                 ))}
                 <button onClick={() => setPaperSize('Custom')} className={`flex-1 py-1.5 text-sm rounded-md transition-colors ${paperSize === 'Custom' ? 'bg-neutral-700 font-bold shadow' : 'text-neutral-400 hover:text-white'}`}>Свой</button>
               </div>
               <div className="grid grid-cols-2 gap-4">
                  <div><label className="text-xs text-neutral-500 block mb-1">Поля (мм)</label><input type="number" value={pageMargin} onChange={handleDimChange(setPageMargin)} className="w-full bg-neutral-900 border border-neutral-700 rounded px-2 py-1.5 text-white" /></div>
                  <div><label className="text-xs text-neutral-500 block mb-1">Зазор (мм)</label><input type="number" value={photoGap} onChange={handleDimChange(setPhotoGap)} className="w-full bg-neutral-900 border border-neutral-700 rounded px-2 py-1.5 text-white" /></div>
                  {paperSize === 'Custom' && (
                    <>
                      <div><label className="text-xs text-neutral-500 block mb-1">Ширина листа</label><input type="number" value={paperWidth} onChange={handleDimChange(setPaperWidth)} className="w-full bg-neutral-900 border border-neutral-700 rounded px-2 py-1.5 text-white" /></div>
                      <div><label className="text-xs text-neutral-500 block mb-1">Высота листа</label><input type="number" value={paperHeight} onChange={handleDimChange(setPaperHeight)} className="w-full bg-neutral-900 border border-neutral-700 rounded px-2 py-1.5 text-white" /></div>
                    </>
                  )}
               </div>
            </div>
            <div className="bg-neutral-200 rounded-xl p-4 overflow-auto flex justify-center shadow-inner min-h-[300px]">
               {printSheetImage ? <img src={printSheetImage} alt="Sheet" className="shadow-2xl border border-neutral-300 max-w-full h-auto object-contain" /> : <div className="text-neutral-500 m-auto">Генерация...</div>}
            </div>
            <div className="bg-neutral-800 p-3 rounded-lg border border-neutral-700 text-center text-sm text-neutral-300">Поместилось фото: <span className="text-emerald-400 font-bold text-lg">{photosCount}</span> шт.</div>
            <div className="space-y-2 sticky bottom-4">
                <button onClick={() => handleDownload(printSheetImage, `print_sheet_${paperSize}.jpg`)} className="w-full py-4 bg-emerald-500 hover:bg-emerald-600 text-white font-bold rounded-xl shadow-lg flex items-center justify-center gap-2 active:scale-[0.98]">
                    <Download size={20} /> Скачать лист
                </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
