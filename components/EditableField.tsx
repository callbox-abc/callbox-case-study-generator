"use client";

import { useLayoutEffect, useRef } from "react";

type Props = {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  style?: React.CSSProperties;
};

// Auto-growing field so long edited content isn't clipped on-screen or
// truncated when printed (textareas don't reliably paginate overflow in print).
export default function EditableField({ value, onChange, placeholder, multiline, style }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const autoSize = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  };

  useLayoutEffect(() => {
    autoSize();
  }, [value]);

  const common = {
    value: value || "",
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(e.target.value),
    placeholder,
    style: {
      border: "none",
      outline: "none",
      background: "transparent",
      font: "inherit",
      color: "inherit",
      width: "100%",
      resize: "none" as const,
      overflow: "hidden",
      ...style,
    },
  };

  if (multiline) return <textarea ref={ref} rows={1} {...common} />;
  return <input {...common} />;
}
