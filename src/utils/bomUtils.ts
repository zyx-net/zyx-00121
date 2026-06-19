export const UTF8_BOM = "\uFEFF";

export function hasBOM(text: string): boolean {
  return text.length > 0 && text.charCodeAt(0) === 0xfeff;
}

export function stripBOM(text: string): string {
  if (hasBOM(text)) {
    return text.slice(1);
  }
  return text;
}

export function detectAndStripBOM(text: string): { text: string; hasBOM: boolean } {
  const bomPresent = hasBOM(text);
  return {
    text: bomPresent ? text.slice(1) : text,
    hasBOM: bomPresent,
  };
}

export function readFileWithBOMHandling(file: File): Promise<{ text: string; hasBOM: boolean }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      resolve(detectAndStripBOM(content));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file, "UTF-8");
  });
}

export function readFileSyncWithBOMHandling(path: string, fs: { readFileSync: (p: string, enc: string) => string }): { text: string; hasBOM: boolean } {
  const content = fs.readFileSync(path, "utf-8");
  return detectAndStripBOM(content);
}
