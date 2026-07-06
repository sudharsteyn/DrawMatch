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
