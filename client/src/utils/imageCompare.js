// Utility to compare two canvases and return a similarity percentage (0 - 100)

// Helper to get raw similarity between two imageData arrays
const getRawSimilarity = (playerCtx, refCtx, sampleWidth, sampleHeight) => {
  const playerImgData = playerCtx.getImageData(0, 0, sampleWidth, sampleHeight).data;
  const refImgData = refCtx.getImageData(0, 0, sampleWidth, sampleHeight).data;

  let totalDifference = 0;
  const totalPixels = sampleWidth * sampleHeight;
  const maxPossibleDiffPerPixel = 255 * 3; // R, G, B differences (ignoring Alpha)

  for (let i = 0; i < playerImgData.length; i += 4) {
    const rDiff = Math.abs(playerImgData[i] - refImgData[i]);
    const gDiff = Math.abs(playerImgData[i + 1] - refImgData[i + 1]);
    const bDiff = Math.abs(playerImgData[i + 2] - refImgData[i + 2]);
    totalDifference += (rDiff + gDiff + bDiff);
  }

  const maxTotalDifference = totalPixels * maxPossibleDiffPerPixel;
  return 1 - (totalDifference / maxTotalDifference);
};

export const calculateSimilarity = (playerCanvas, referenceCanvas, baselineScore = 0) => {
  if (!playerCanvas || !referenceCanvas) return 0;

  const sampleWidth = 64; 
  const sampleHeight = Math.floor(sampleWidth * (playerCanvas.height / playerCanvas.width));

  const tempPlayerCanvas = document.createElement('canvas');
  const tempRefCanvas = document.createElement('canvas');
  
  tempPlayerCanvas.width = sampleWidth;
  tempPlayerCanvas.height = sampleHeight;
  tempRefCanvas.width = sampleWidth;
  tempRefCanvas.height = sampleHeight;

  const playerCtx = tempPlayerCanvas.getContext('2d', { willReadFrequently: true });
  const refCtx = tempRefCanvas.getContext('2d', { willReadFrequently: true });

  playerCtx.drawImage(playerCanvas, 0, 0, sampleWidth, sampleHeight);
  refCtx.drawImage(referenceCanvas, 0, 0, sampleWidth, sampleHeight);

  const rawSimilarity = getRawSimilarity(playerCtx, refCtx, sampleWidth, sampleHeight);
  
  // Normalize the score based on the baseline (a completely blank canvas)
  // If player score is equal to or worse than doing nothing, it's 0%
  let normalized = 0;
  if (rawSimilarity > baselineScore) {
      normalized = (rawSimilarity - baselineScore) / (1 - baselineScore);
  }

  // Apply a slight curve to make it feel more rewarding in the higher ranges
  let percentage = Math.pow(normalized, 1.5) * 100;

  return parseFloat(percentage.toFixed(1));
};

export const calculateBaseline = (referenceCanvas) => {
  if (!referenceCanvas) return 0;

  const sampleWidth = 64; 
  const sampleHeight = Math.floor(sampleWidth * (referenceCanvas.height / referenceCanvas.width));

  const tempBlankCanvas = document.createElement('canvas');
  const tempRefCanvas = document.createElement('canvas');
  
  tempBlankCanvas.width = sampleWidth;
  tempBlankCanvas.height = sampleHeight;
  tempRefCanvas.width = sampleWidth;
  tempRefCanvas.height = sampleHeight;

  const blankCtx = tempBlankCanvas.getContext('2d', { willReadFrequently: true });
  const refCtx = tempRefCanvas.getContext('2d', { willReadFrequently: true });

  // Fill blank canvas with white
  blankCtx.fillStyle = '#ffffff';
  blankCtx.fillRect(0, 0, sampleWidth, sampleHeight);

  refCtx.drawImage(referenceCanvas, 0, 0, sampleWidth, sampleHeight);

  return getRawSimilarity(blankCtx, refCtx, sampleWidth, sampleHeight);
};

export const generateDiffOverlay = (playerCanvas, referenceCanvas) => {
  if (!playerCanvas || !referenceCanvas) return null;

  const width = playerCanvas.width;
  const height = playerCanvas.height;

  const tempPlayer = document.createElement('canvas');
  tempPlayer.width = width;
  tempPlayer.height = height;
  const pCtx = tempPlayer.getContext('2d', { willReadFrequently: true });
  pCtx.drawImage(playerCanvas, 0, 0);

  const tempRef = document.createElement('canvas');
  tempRef.width = width;
  tempRef.height = height;
  const rCtx = tempRef.getContext('2d', { willReadFrequently: true });
  rCtx.drawImage(referenceCanvas, 0, 0);

  const pData = pCtx.getImageData(0, 0, width, height).data;
  const rData = rCtx.getImageData(0, 0, width, height).data;

  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = width;
  maskCanvas.height = height;
  const mCtx = maskCanvas.getContext('2d');
  const maskImgData = mCtx.createImageData(width, height);
  const mData = maskImgData.data;

  // Tolerance for difference (sum of RGB diffs). Max is 765. 
  const THRESHOLD = 120; 

  for (let i = 0; i < pData.length; i += 4) {
    const rDiff = Math.abs(pData[i] - rData[i]);
    const gDiff = Math.abs(pData[i+1] - rData[i+1]);
    const bDiff = Math.abs(pData[i+2] - rData[i+2]);
    
    if (rDiff + gDiff + bDiff > THRESHOLD) {
       // Mark this pixel as solid in the mask
       mData[i] = 0;
       mData[i+1] = 0;
       mData[i+2] = 0;
       mData[i+3] = 255; // Fully opaque mask
    } else {
       mData[i+3] = 0;   // Transparent
    }
  }
  mCtx.putImageData(maskImgData, 0, 0);

  // Now create the final overlay with red hashes
  const diffCanvas = document.createElement('canvas');
  diffCanvas.width = width;
  diffCanvas.height = height;
  const dCtx = diffCanvas.getContext('2d');

  // Draw diagonal lines
  dCtx.strokeStyle = 'rgba(239, 68, 68, 0.7)'; // Red hashes
  dCtx.lineWidth = 3;
  dCtx.beginPath();
  for (let i = -height; i < width * 2; i += 12) {
      dCtx.moveTo(i, 0);
      dCtx.lineTo(i - height, height);
  }
  dCtx.stroke();

  // Mask it!
  dCtx.globalCompositeOperation = 'destination-in';
  dCtx.drawImage(maskCanvas, 0, 0);

  return diffCanvas.toDataURL();
};
