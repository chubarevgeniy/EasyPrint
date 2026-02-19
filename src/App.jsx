import React, { useState, useRef, useEffect, useCallback } from 'react';
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

  // --- Print Sheet Logic ---
  const generatePrintSheet = useCallback(() => {
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
  }, [paperWidth, paperHeight, pageMargin, photoGap, croppedImage, PIXELS_PER_MM]);

  useEffect(() => {
    if (step === 'print' && croppedImage) {
      generatePrintSheet();
    }
  }, [step, croppedImage, generatePrintSheet]);


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
        } catch (error) {
            console.error(error);
        }
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
    <div className="min-h-screen bg-swiss-white text-swiss-black font-mono flex flex-col items-center selection:bg-swiss-red selection:text-white">
      {/* Header */}
      <header className="w-full p-4 border-b border-swiss-black flex items-center justify-between sticky top-0 z-30 bg-swiss-white/80 backdrop-blur-sm">
        <h1 className="text-lg font-bold flex items-center gap-2 uppercase tracking-widest">
          <Scissors className="w-5 h-5 text-swiss-red" />
          <span className="hidden sm:inline">Photo Docs</span>
        </h1>
        <div className="flex items-center gap-2">
          {step !== 'upload' && step !== 'crop' && (
            <button onClick={() => step === 'print' ? setStep('result') : setStep('crop')} className="text-xs text-swiss-black hover:text-swiss-red px-2 py-1 flex items-center gap-1 uppercase tracking-wider border border-transparent hover:border-swiss-red transition-colors">
              <ArrowLeft size={14}/> Back
            </button>
          )}
          {step === 'crop' && imageSrc && (
             <button onClick={() => { setImageSrc(null); setStep('upload'); }} className="text-xs text-swiss-black hover:text-swiss-red px-2 py-1 uppercase tracking-wider border border-transparent hover:border-swiss-red transition-colors">Reset</button>
          )}
        </div>
      </header>

      <main className="flex-1 w-full max-w-2xl p-4 flex flex-col gap-6">
        {step === 'upload' && (
          <div className="flex-1 flex flex-col items-center justify-center border-2 border-dashed border-swiss-gray p-8 my-auto animate-in fade-in zoom-in-95 relative overflow-hidden group">
            {/* Corner Markers for Decoration */}
            <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-swiss-black"></div>
            <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-swiss-black"></div>
            <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-swiss-black"></div>
            <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-swiss-black"></div>

            <Upload className="w-16 h-16 text-swiss-gray mb-6 group-hover:text-swiss-red transition-colors" strokeWidth={1} />
            <h2 className="text-xl font-bold uppercase tracking-widest mb-2">Upload Photo</h2>
            <p className="text-swiss-gray text-center mb-8 max-w-xs text-xs uppercase tracking-wide">Select image to process</p>
            <label className="bg-swiss-black text-swiss-white hover:bg-swiss-red hover:text-swiss-black font-bold py-4 px-8 cursor-pointer transition-all shadow-[4px_4px_0px_0px_rgba(0,0,0,0.2)] hover:shadow-none hover:translate-x-[2px] hover:translate-y-[2px] flex items-center gap-2 uppercase tracking-widest text-sm border border-swiss-black">
              <Upload size={18}/> Select File
              <input type="file" accept="image/*" onChange={handleFileChange} className="hidden" />
            </label>
          </div>
        )}

        {step === 'crop' && (
          <>
            <div className="bg-swiss-white p-4 border border-swiss-gray shadow-none relative">
              <div className="absolute top-0 left-2 -translate-y-1/2 bg-swiss-white px-1 text-[10px] text-swiss-red uppercase font-bold tracking-widest">Dimensions (mm)</div>
              <div className="flex gap-4 items-end mt-2">
                <div className="flex-1">
                  <label className="text-[10px] uppercase text-swiss-gray font-bold mb-1 block">Width</label>
                  <input type="number" value={widthMM} onChange={handleDimChange(setWidthMM)} className="w-full bg-transparent border-b border-swiss-gray focus:border-swiss-red py-2 text-xl font-mono text-swiss-black outline-none transition-colors rounded-none" placeholder="35"/>
                </div>
                <div className="flex-1">
                  <label className="text-[10px] uppercase text-swiss-gray font-bold mb-1 block">Height</label>
                  <input type="number" value={heightMM} onChange={handleDimChange(setHeightMM)} className="w-full bg-transparent border-b border-swiss-gray focus:border-swiss-red py-2 text-xl font-mono text-swiss-black outline-none transition-colors rounded-none" placeholder="45"/>
                </div>
              </div>
            </div>

            <div className="flex-1 flex items-center justify-center min-h-0 bg-swiss-gray/10 overflow-hidden border border-swiss-gray relative">
                {/* Tech Overlays */}
                <div className="absolute top-2 left-2 z-20 bg-swiss-white/80 backdrop-blur border border-swiss-black/20 px-2 py-1 text-[10px] text-swiss-black uppercase tracking-wider pointer-events-none">
                  PAN MODE
                </div>
                <div className="absolute bottom-2 right-2 z-20 text-[10px] text-swiss-gray uppercase tracking-widest pointer-events-none">
                  PREVIEW
                </div>

                <div
                    ref={containerRef}
                    style={getPreviewContainerStyle()}
                    className="relative overflow-hidden bg-swiss-white cursor-move touch-none border border-swiss-black shadow-2xl"
                    {...pointerEvents}
                >
                    {/* Сетка */}
                    <div className="absolute inset-0 z-20 pointer-events-none opacity-50 border border-swiss-black/50">
                        <div className="w-full h-1/3 border-b border-dashed border-swiss-black/30"></div>
                        <div className="w-full h-1/3 border-b border-dashed border-swiss-black/30"></div>
                    </div>
                    <div className="absolute inset-0 z-20 pointer-events-none opacity-50 flex">
                        <div className="h-full w-1/3 border-r border-dashed border-swiss-black/30"></div>
                        <div className="h-full w-1/3 border-r border-dashed border-swiss-black/30"></div>
                    </div>

                    {/* Center Crosshair */}
                     <div className="absolute inset-0 z-30 pointer-events-none flex items-center justify-center">
                        <div className="w-4 h-4 border border-swiss-red/50 rounded-full"></div>
                        <div className="w-2 h-[1px] bg-swiss-red absolute"></div>
                        <div className="h-2 w-[1px] bg-swiss-red absolute"></div>
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

            <div className="bg-swiss-white p-5 border-t border-swiss-gray space-y-6">
              <div className="space-y-4">
                <div className="flex justify-between text-xs font-bold text-swiss-gray uppercase tracking-widest border-b border-swiss-gray/30 pb-2">
                  <span className="flex items-center gap-1"><ZoomIn size={12}/> Zoom Level</span>
                  <span className="text-swiss-red">{(zoom * 100).toFixed(0)}%</span>
                </div>

                <div className="flex items-center gap-4">
                    <button onClick={zoomOut} className="w-8 h-8 flex items-center justify-center border border-swiss-black hover:bg-swiss-black hover:text-swiss-white transition-all active:translate-y-1"><Minus size={14}/></button>
                    <input type="range" min={MIN_ZOOM} max={MAX_ZOOM} step={ZOOM_STEP} value={zoom} onChange={handleZoomChange} className="flex-1 h-[2px] bg-swiss-gray appearance-none cursor-pointer accent-swiss-red"/>
                    <button onClick={zoomIn} className="w-8 h-8 flex items-center justify-center border border-swiss-black hover:bg-swiss-black hover:text-swiss-white transition-all active:translate-y-1"><Plus size={14}/></button>
                </div>
              </div>

              <button onClick={generateSingleImage} disabled={isProcessing} className="w-full py-4 bg-swiss-black text-swiss-white hover:bg-swiss-red hover:text-swiss-black disabled:bg-swiss-gray disabled:text-swiss-white/50 font-bold uppercase tracking-[0.2em] transition-all flex items-center justify-center gap-3 border border-swiss-black active:translate-y-[2px]">
                {isProcessing ? 'Processing...' : 'Generate ->'}
              </button>
            </div>
          </>
        )}

        {step === 'result' && croppedImage && (
           <div className="flex flex-col items-center gap-8 animate-in slide-in-from-right duration-300 py-4">
             <div className="bg-swiss-black p-2 border border-swiss-black shadow-[8px_8px_0px_0px_rgba(26,26,26,1)]">
                <img src={croppedImage} alt="Single" className="max-h-[35vh] grayscale-[0.1]" />
             </div>
             <div className="w-full space-y-4">
               <button onClick={() => setStep('print')} className="w-full py-4 bg-swiss-black text-swiss-white hover:bg-swiss-red hover:text-swiss-black font-bold uppercase tracking-[0.2em] border border-swiss-black shadow-lg flex items-center justify-center gap-2 active:translate-y-1 transition-all">
                 <LayoutGrid size={18} /> Prepare Print Sheet
               </button>
               <button onClick={() => handleDownload(croppedImage, `photo-${widthMM}x${heightMM}.jpg`)} className="w-full py-4 bg-transparent text-swiss-black hover:bg-swiss-black hover:text-swiss-white font-medium border border-swiss-black uppercase tracking-widest flex items-center justify-center gap-2 active:translate-y-1 transition-all">
                 <Share size={18} /> Download Single
               </button>
             </div>
           </div>
        )}

        {step === 'print' && (
          <div className="flex flex-col gap-6 animate-in slide-in-from-right duration-300 pb-20">
            <div className="bg-swiss-white p-4 border border-swiss-gray space-y-6 relative">
               <div className="absolute top-0 left-4 -translate-y-1/2 bg-swiss-white px-2 text-xs text-swiss-red font-bold uppercase tracking-widest border border-swiss-gray">Print Settings</div>

               <div className="flex bg-swiss-gray/20 p-1 border border-swiss-gray/50">
                 {['A4', '10x15', 'A6'].map(p => (
                   <button key={p} onClick={() => handlePaperPreset(p)} className={`flex-1 py-1.5 text-xs uppercase tracking-wider transition-colors ${paperSize === p ? 'bg-swiss-black text-swiss-white font-bold' : 'text-swiss-gray hover:text-swiss-black'}`}>{p}</button>
                 ))}
                 <button onClick={() => setPaperSize('Custom')} className={`flex-1 py-1.5 text-xs uppercase tracking-wider transition-colors ${paperSize === 'Custom' ? 'bg-swiss-black text-swiss-white font-bold' : 'text-swiss-gray hover:text-swiss-black'}`}>Custom</button>
               </div>

               <div className="grid grid-cols-2 gap-6">
                  <div><label className="text-[10px] text-swiss-gray uppercase font-bold block mb-1">Margin (mm)</label><input type="number" value={pageMargin} onChange={handleDimChange(setPageMargin)} className="w-full bg-transparent border-b border-swiss-gray focus:border-swiss-red rounded-none px-2 py-1.5 text-swiss-black font-mono outline-none transition-colors" /></div>
                  <div><label className="text-[10px] text-swiss-gray uppercase font-bold block mb-1">Gap (mm)</label><input type="number" value={photoGap} onChange={handleDimChange(setPhotoGap)} className="w-full bg-transparent border-b border-swiss-gray focus:border-swiss-red rounded-none px-2 py-1.5 text-swiss-black font-mono outline-none transition-colors" /></div>
                  {paperSize === 'Custom' && (
                    <>
                      <div><label className="text-[10px] text-swiss-gray uppercase font-bold block mb-1">Sheet Width</label><input type="number" value={paperWidth} onChange={handleDimChange(setPaperWidth)} className="w-full bg-transparent border-b border-swiss-gray focus:border-swiss-red rounded-none px-2 py-1.5 text-swiss-black font-mono outline-none transition-colors" /></div>
                      <div><label className="text-[10px] text-swiss-gray uppercase font-bold block mb-1">Sheet Height</label><input type="number" value={paperHeight} onChange={handleDimChange(setPaperHeight)} className="w-full bg-transparent border-b border-swiss-gray focus:border-swiss-red rounded-none px-2 py-1.5 text-swiss-black font-mono outline-none transition-colors" /></div>
                    </>
                  )}
               </div>
            </div>

            <div className="bg-neutral-200 p-4 overflow-auto flex justify-center shadow-inner min-h-[300px] border border-swiss-black/50 relative">
               <div className="absolute top-2 left-2 text-[10px] text-black/50 uppercase tracking-widest font-bold z-10">Preview Canvas</div>
               {printSheetImage ? <img src={printSheetImage} alt="Sheet" className="shadow-2xl border border-neutral-400 max-w-full h-auto object-contain" /> : <div className="text-neutral-500 m-auto font-mono uppercase text-xs tracking-widest">Generating...</div>}
            </div>

            <div className="bg-swiss-white p-3 border border-swiss-gray text-center text-xs uppercase tracking-widest text-swiss-gray">Photos fit: <span className="text-swiss-red font-bold text-lg mx-2">{photosCount}</span> pcs</div>

            <div className="space-y-2 sticky bottom-4">
                <button onClick={() => handleDownload(printSheetImage, `print_sheet_${paperSize}.jpg`)} className="w-full py-4 bg-swiss-black text-swiss-white hover:bg-swiss-red hover:text-swiss-black font-bold uppercase tracking-[0.2em] border border-swiss-black shadow-[4px_4px_0px_0px_rgba(0,0,0,0.2)] hover:shadow-none hover:translate-x-[2px] hover:translate-y-[2px] transition-all flex items-center justify-center gap-3">
                    <Download size={18} /> Download Sheet
                </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
