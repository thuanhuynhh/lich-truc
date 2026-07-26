import React, { useRef, useState, useEffect } from "react";

interface SignaturePadProps {
  onSave: (dataUrl: string, name: string) => void;
  onQuickSave?: (name: string) => void;
  storedSignature?: string | null;
  defaultName?: string;
  label: string;
}

export function SignaturePad({ onSave, onQuickSave, storedSignature, defaultName = "", label }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [name, setName] = useState(defaultName);
  const [hasSigned, setHasSigned] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.strokeStyle = "#1e293b"; // Slate 800
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }, []);

  useEffect(() => {
    setName(defaultName);
  }, [defaultName]);

  const getCoordinates = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    
    // Support touch vs mouse
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
    
    // Scale screen coordinates to canvas native resolution
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY
    };
  };

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (e.cancelable) e.preventDefault();
    const coords = getCoordinates(e);
    if (!coords) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.beginPath();
    ctx.moveTo(coords.x, coords.y);
    setIsDrawing(true);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    if (e.cancelable) e.preventDefault();
    const coords = getCoordinates(e);
    if (!coords) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.lineTo(coords.x, coords.y);
    ctx.stroke();
    setHasSigned(true);
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const clear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasSigned(false);
  };

  const handleSave = () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasSigned) return;
    const dataUrl = canvas.toDataURL("image/png");
    onSave(dataUrl, name);
  };

  return (
    <div className="signature-pad-card">
      <h5>{label}</h5>
      <div className="signature-canvas-wrapper">
        <canvas
          ref={canvasRef}
          width={300}
          height={120}
          className="signature-canvas"
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
        />
      </div>
      <div className="signature-pad-controls">
        <input
          type="text"
          placeholder="Họ và tên người ký"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="signature-name-input"
        />
        {storedSignature && onQuickSave && (
          <button
            type="button"
            className="primary-btn signature-quick-save"
            disabled={!name.trim()}
            onClick={() => onQuickSave(name.trim())}
          >
            Ký nhanh bằng chữ ký mẫu
          </button>
        )}
        <div className="signature-buttons">
          <button type="button" onClick={clear} className="tool-btn signature-btn-clear">
            Xóa vẽ
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="primary-btn signature-btn-save"
            disabled={!hasSigned || !name.trim()}
          >
            Ký & Lưu
          </button>
        </div>
      </div>
    </div>
  );
}
