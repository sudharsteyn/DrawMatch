// Utility to extract dominant colors from a canvas

export const extractColorsFromCanvas = (canvas, maxColors = 8) => {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  // Process the actual image resolution but step to save performance
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  
  const colorCounts = {};

  // Step through pixels (skip every 12 pixels for speed)
  for (let i = 0; i < imgData.length; i += 4 * 12) {
    const r = imgData[i];
    const g = imgData[i + 1];
    const b = imgData[i + 2];
    
    const hex = rgbToHex(r, g, b);
    colorCounts[hex] = (colorCounts[hex] || 0) + 1;
  }

  // Sort by frequency
  const sortedColors = Object.keys(colorCounts).sort((a, b) => colorCounts[b] - colorCounts[a]);
  
  const palette = [];
  
  for (const hex of sortedColors) {
    if (palette.length >= maxColors) break;
    
    let isTooSimilar = false;
    for (const pHex of palette) {
       // If the color is very close to one already in the palette, skip it (ignores anti-aliasing edges)
       if (colorDistance(hex, pHex) < 45) { 
           isTooSimilar = true;
           break;
       }
    }
    
    if (!isTooSimilar) {
        palette.push(hex);
    }
  }

  return palette;
};

const rgbToHex = (r, g, b) => {
  return "#" + (1 << 24 | r << 16 | g << 8 | b).toString(16).slice(1).toUpperCase();
};

// Calculates the Euclidean distance between two hex colors in RGB space
const colorDistance = (hex1, hex2) => {
    const r1 = parseInt(hex1.substring(1, 3), 16);
    const g1 = parseInt(hex1.substring(3, 5), 16);
    const b1 = parseInt(hex1.substring(5, 7), 16);
    const r2 = parseInt(hex2.substring(1, 3), 16);
    const g2 = parseInt(hex2.substring(3, 5), 16);
    const b2 = parseInt(hex2.substring(5, 7), 16);
    return Math.sqrt(Math.pow(r2 - r1, 2) + Math.pow(g2 - g1, 2) + Math.pow(b2 - b1, 2));
};
