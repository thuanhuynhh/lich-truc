import { ReactNode, useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import type { Department } from "../shared/types";

export function PanelTitle({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div className="panel-title">
      {icon}
      <h2>{title}</h2>
    </div>
  );
}

/** Đọc ảnh chữ ký thành data URL và thu nhỏ lại để không phình payload. */
export const toBase64 = (file: File, maxWidth = 240): Promise<string> =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let width = img.width;
        let height = img.height;

        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Không tạo được context 2D"));
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/png"));
      };
      img.onerror = (error) => reject(error);
    };
    reader.onerror = (error) => reject(error);
  });

export function DepartmentSearchSelect({
  value,
  options,
  onChange,
  placeholder = "Tìm khoa phòng",
  ariaLabel,
  disabled = false
}: {
  value: number | "";
  options: Department[];
  onChange: (value: number | "") => void;
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const selected = options.find((option) => option.id === value) || null;

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  const normalizedQuery = query.trim().toLowerCase();
  const matches = normalizedQuery
    ? options.filter((option) => option.name.toLowerCase().includes(normalizedQuery))
    : options;

  return (
    <div className="search-select" ref={containerRef}>
      <div className="search-select-control">
        <Search size={14} aria-hidden="true" />
        <input
          type="text"
          value={open ? query : selected?.name || ""}
          placeholder={placeholder}
          aria-label={ariaLabel || placeholder}
          disabled={disabled}
          onFocus={() => {
            setOpen(true);
            setQuery("");
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
        />
        {selected && !disabled && (
          <button
            type="button"
            className="search-select-clear"
            aria-label="Bỏ chọn khoa phòng"
            onClick={() => {
              onChange("");
              setQuery("");
            }}
          >
            ×
          </button>
        )}
      </div>
      {open && !disabled && (
        <ul className="search-select-list" role="listbox">
          {matches.length === 0 && <li className="search-select-empty">Không có khoa phòng phù hợp</li>}
          {matches.map((option) => (
            <li key={option.id}>
              <button
                type="button"
                role="option"
                aria-selected={option.id === value}
                className={option.id === value ? "active" : ""}
                onClick={() => {
                  onChange(option.id);
                  setQuery("");
                  setOpen(false);
                }}
              >
                {option.name}
                {!option.active && <span className="search-select-tag">đã tắt</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
