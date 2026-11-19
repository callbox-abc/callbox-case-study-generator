"use client";

import { useLayoutEffect, useRef } from "react";

type Props = {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  style?: React.CSSProperties;
  // Focus the field when it appears, with the caret at `caret` (default: the end).
  autoFocus?: boolean;
  caret?: number;
  onBlur?: () => void;
};

// Auto-growing field so long edited content isn't clipped on-screen or
// truncated when printed (textareas don't reliably paginate overflow in print).
export default function EditableField({ value, onChange, placeholder, multiline, style, autoFocus, caret, onBlur }: Props) {
  const ref = useRef<HTMLTextAreaElement & HTMLInputElement>(null);

  const autoSize = () => {
    const el = ref.current;
    if (!el || !multiline) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  };

  useLayoutEffect(() => {
    autoSize();
  }, [value]);

  // Only when the field first appears: later renders must not move the caret while typing.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!autoFocus || !el) return;
    const at = Math.min(caret ?? el.value.length, el.value.length);
    el.focus();
    el.setSelectionRange(at, at);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const common = {
    value: value || "",
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(e.target.value),
    onBlur,
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
  return <input ref={ref} {...common} />;
}
