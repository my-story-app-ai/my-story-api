export const OUTPUT_PRESETS = {
  Snapshot: [
    {
      id: "snapshot-digital",
      outputType: "digital",
      label: "Digital",
      resultLabel: "Digital image",
      ratio: "1:1",
      targetPixels: null
    },
    {
      id: "snapshot-print-10x15",
      outputType: "print",
      label: "Print-ready 10 x 15 cm",
      resultLabel: "Print-ready · 10 x 15 cm",
      ratio: "2:3",
      targetPixels: { width: 1181, height: 1772, dpi: 300 }
    },
    {
      id: "snapshot-print-15x20",
      outputType: "print",
      label: "Print-ready 15 x 20 cm",
      resultLabel: "Print-ready · 15 x 20 cm",
      ratio: "3:4",
      targetPixels: { width: 1772, height: 2362, dpi: 300 }
    }
  ],
  "My Story": [
    {
      id: "story-digital",
      outputType: "digital",
      label: "Digital Story",
      resultLabel: "Digital story",
      ratio: "story",
      targetPixels: null
    },
    {
      id: "story-print-30x40",
      outputType: "print",
      label: "Print-ready 30 x 40 cm",
      resultLabel: "Print-ready · 30 x 40 cm",
      ratio: "3:4",
      targetPixels: { width: 3543, height: 4724, dpi: 300 }
    },
    {
      id: "story-print-50x70",
      outputType: "print",
      label: "Print-ready 50 x 70 cm",
      resultLabel: "Print-ready · 50 x 70 cm",
      ratio: "5:7",
      targetPixels: { width: 5906, height: 8268, dpi: 300 }
    }
  ]
};

export function presetsForFormat(format){
  return OUTPUT_PRESETS[format] || [];
}

export function resolveOutputPreset(format, requestedPresetId){
  const presets=presetsForFormat(format);
  if(!presets.length) return null;
  if(!requestedPresetId) return presets[0];
  return presets.find(preset=>preset.id===requestedPresetId) || null;
}
