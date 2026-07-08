import React, { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { io } from 'socket.io-client';
import { calculateSimilarity, calculateBaseline, generateDiffOverlay } from './utils/imageCompare';
import { extractColorsFromCanvas } from './utils/extractColors';
import { playClick, playTick, playWin, playLose, startDrawingSound, stopDrawingSound } from './utils/audio';

const Canvas = forwardRef(({ isPlayer, color, brushSize, socket, roomId, onScoreUpdate, referenceCanvasRef, showGrid, baselineScore, isLineTool }, ref) => {
  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const lastPos = useRef(null);
  const lineStartPos = useRef(null);
  const previewEndPos = useRef(null);
  const currentStrokeId = useRef(null);
  const strokesHistory = useRef([]);

  const redrawCanvas = (strokes) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // Group segments by strokeId to prevent alpha overlapping
    const paths = {};
    const pathOrder = [];
    strokes.forEach(s => {
      if (!paths[s.strokeId]) {
        paths[s.strokeId] = { color: s.color, size: s.size, points: [{x: s.startX, y: s.startY}] };
        pathOrder.push(s.strokeId);
      }
      paths[s.strokeId].points.push({x: s.endX, y: s.endY});
    });

    pathOrder.forEach(id => {
      const p = paths[id];
      ctx.beginPath();
      ctx.moveTo(p.points[0].x, p.points[0].y);
      for (let i = 1; i < p.points.length; i++) {
        ctx.lineTo(p.points[i].x, p.points[i].y);
      }
      ctx.strokeStyle = p.color;
      ctx.lineWidth = p.size;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
    });
  };

  useImperativeHandle(ref, () => ({
    getCanvas: () => canvasRef.current,
    undo: () => {
       if (strokesHistory.current.length === 0) return;
       const lastStrokeId = strokesHistory.current[strokesHistory.current.length - 1].strokeId;
       strokesHistory.current = strokesHistory.current.filter(s => s.strokeId !== lastStrokeId);
       redrawCanvas(strokesHistory.current);
       if (isPlayer && onScoreUpdate && referenceCanvasRef.current) {
           const newScore = calculateSimilarity(canvasRef.current, referenceCanvasRef.current, baselineScore);
           onScoreUpdate(newScore);
           if (socket && roomId) socket.emit('undoStroke', { roomId });
       }
    },
    clear: () => {
       strokesHistory.current = [];
       redrawCanvas([]);
       if (isPlayer && onScoreUpdate) {
           onScoreUpdate(0);
           if (socket && roomId) socket.emit('clearCanvas', { roomId });
       }
    },
    addExternalStroke: (stroke) => {
       strokesHistory.current.push(stroke);
       redrawCanvas(strokesHistory.current);
    },
    setInitialStrokes: (strokes) => {
       strokesHistory.current = strokes;
       redrawCanvas(strokes);
    },
    remoteUndo: (strokeId) => {
       if (strokeId) {
           strokesHistory.current = strokesHistory.current.filter(s => s.strokeId !== strokeId);
       } else {
           const lastStrokeId = strokesHistory.current.length > 0 ? strokesHistory.current[strokesHistory.current.length - 1].strokeId : null;
           strokesHistory.current = strokesHistory.current.filter(s => s.strokeId !== lastStrokeId);
       }
       redrawCanvas(strokesHistory.current);
    },
    remoteClear: () => {
       strokesHistory.current = [];
       redrawCanvas([]);
    }
  }));

  useEffect(() => {
    redrawCanvas([]);
  }, []);

  const getCoordinates = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY
    };
  };

  const startDrawing = (e) => {
    if (!isPlayer) return;
    e.target.setPointerCapture(e.pointerId);
    const { x, y } = getCoordinates(e);
    lastPos.current = { x, y };
    lineStartPos.current = { x, y };
    previewEndPos.current = { x, y };
    currentStrokeId.current = Math.random().toString(36).substr(2, 9);
    setIsDrawing(true);
    startDrawingSound();
  };

  const draw = (e) => {
    if (!isDrawing || !isPlayer) return;
    const { x: currentX, y: currentY } = getCoordinates(e);
    
    if (isLineTool) {
        previewEndPos.current = { x: currentX, y: currentY };
        redrawCanvas(strokesHistory.current);
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        ctx.beginPath();
        ctx.moveTo(lineStartPos.current.x, lineStartPos.current.y);
        ctx.lineTo(currentX, currentY);
        ctx.strokeStyle = color;
        ctx.lineWidth = brushSize;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();
        return;
    }

    const strokeObj = {
        strokeId: currentStrokeId.current,
        startX: lastPos.current.x,
        startY: lastPos.current.y,
        endX: currentX,
        endY: currentY,
        color,
        size: brushSize
    };
    strokesHistory.current.push(strokeObj);
    redrawCanvas(strokesHistory.current);

    if (socket && roomId) {
      socket.emit('drawData', {
        roomId,
        strokeData: strokeObj
      });
    }

    lastPos.current = { x: currentX, y: currentY };
  };

  const endDrawing = (e) => {
    if (!isPlayer) return;
    stopDrawingSound();
    if (e && e.target && e.pointerId) {
        e.target.releasePointerCapture(e.pointerId);
    }
    
    if (isDrawing && isLineTool && lineStartPos.current && previewEndPos.current) {
        const strokeObj = {
            strokeId: currentStrokeId.current,
            startX: lineStartPos.current.x,
            startY: lineStartPos.current.y,
            endX: previewEndPos.current.x,
            endY: previewEndPos.current.y,
            color,
            size: brushSize
        };
        strokesHistory.current.push(strokeObj);
        redrawCanvas(strokesHistory.current);
        if (socket && roomId) {
            socket.emit('drawData', { roomId, strokeData: strokeObj });
        }
    }
    
    setIsDrawing(false);
    
    if (referenceCanvasRef && referenceCanvasRef.current) {
        const newScore = calculateSimilarity(canvasRef.current, referenceCanvasRef.current, baselineScore);
        onScoreUpdate(newScore);
    }
  };

  return (
    <>
      <canvas 
        ref={canvasRef}
        width={400}
        height={300}
        onPointerDown={startDrawing}
        onPointerMove={draw}
        onPointerUp={endDrawing}
        onPointerCancel={endDrawing}
        style={{ cursor: isPlayer ? 'crosshair' : 'default', position: 'absolute', top: 0, left: 0, touchAction: 'none' }}
      />
      {showGrid && <div className="grid-overlay"></div>}
    </>
  );
});

function App() {
  const [socket, setSocket] = useState(null);
  const [roomId, setRoomId] = useState('');
  const [joinRoomId, setJoinRoomId] = useState('');
  const [inGame, setInGame] = useState(false);
  const [gameStatus, setGameStatus] = useState('lobby'); // lobby, playing, finished
  const [color, setColor] = useState('#000000');
  const [opacity, setOpacity] = useState(1);
  const [brushSize, setBrushSize] = useState(10);
  const [isEraser, setIsEraser] = useState(false);
  const [isLineTool, setIsLineTool] = useState(false);
  const [showGrid, setShowGrid] = useState(false);
  const [gameCategory, setGameCategory] = useState('shapes');
  const [customImageDataUrl, setCustomImageDataUrl] = useState(null);
  const [isEyedropper, setIsEyedropper] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [currentImage, setCurrentImage] = useState('/reference_2.png');
  const [isImageLoading, setIsImageLoading] = useState(true);
  const [baselineScore, setBaselineScore] = useState(0);
  const [joinError, setJoinError] = useState('');
  
  const [myScore, setMyScore] = useState(0);
  const [opponentScore, setOpponentScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(180);
  const [endTime, setEndTime] = useState(null);
  const [myDiffUrl, setMyDiffUrl] = useState(null);
  const [oppDiffUrl, setOppDiffUrl] = useState(null);
  const [opponentLeft, setOpponentLeft] = useState(false);
  const [opponentDisconnected, setOpponentDisconnected] = useState(false);
  const [rematchStatus, setRematchStatus] = useState('');
  const [copied, setCopied] = useState(false);

  const copyRoomCode = () => {
      navigator.clipboard.writeText(roomId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
  };
  
  const referenceImgRef = useRef(null);
  const referenceCanvasRef = useRef(null); 
  const myCanvasRef = useRef(null);
  const oppCanvasRef = useRef(null);
  const canvasScrollRef = useRef(null);
  const refScrollRef = useRef(null);

  const handleCanvasScroll = (e) => {
      if (refScrollRef.current) {
          if (refScrollRef.current.scrollTop !== e.target.scrollTop) refScrollRef.current.scrollTop = e.target.scrollTop;
          if (refScrollRef.current.scrollLeft !== e.target.scrollLeft) refScrollRef.current.scrollLeft = e.target.scrollLeft;
      }
  };

  const handleRefScroll = (e) => {
      if (canvasScrollRef.current) {
          if (canvasScrollRef.current.scrollTop !== e.target.scrollTop) canvasScrollRef.current.scrollTop = e.target.scrollTop;
          if (canvasScrollRef.current.scrollLeft !== e.target.scrollLeft) canvasScrollRef.current.scrollLeft = e.target.scrollLeft;
      }
  };

  // Dynamic colors array starting with basics, populated on image load
  const [colors, setColors] = useState(['#000000', '#FFFFFF']);

  const hexToRgba = (hex, alpha) => {
      if (hex.startsWith('rgba')) return hex;
      if (!/^#([0-9A-F]{3}){1,2}$/i.test(hex)) return `rgba(0,0,0,${alpha})`;
      let r = 0, g = 0, b = 0;
      if (hex.length === 4) {
          r = parseInt(hex[1] + hex[1], 16);
          g = parseInt(hex[2] + hex[2], 16);
          b = parseInt(hex[3] + hex[3], 16);
      } else if (hex.length === 7) {
          r = parseInt(hex.slice(1, 3), 16);
          g = parseInt(hex.slice(3, 5), 16);
          b = parseInt(hex.slice(5, 7), 16);
      }
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  };

  useEffect(() => {
    // Connect to local server during development, or the current host in production
    const newSocket = import.meta.env.PROD ? io() : io('http://localhost:3001');
    setSocket(newSocket);
    
    newSocket.on('connect', () => {
        console.log('Connected to server');
    });

    newSocket.on('initialState', ({ strokes, scores, referenceImage, gameStarted, endTime }) => {
        if (referenceImage) {
            setCurrentImage(referenceImage);
            setIsImageLoading(true);
        }
        if (gameStarted && endTime) {
            setEndTime(endTime);
            setGameStatus('playing');
        }
        setTimeout(() => {
            const oppStrokes = strokes.filter(s => s.playerId !== newSocket.id);
            if (oppStrokes.length > 0 && oppCanvasRef.current) {
                oppCanvasRef.current.setInitialStrokes(oppStrokes);
            }
            const myStrokes = strokes.filter(s => s.playerId === newSocket.id);
            if (myStrokes.length > 0 && myCanvasRef.current) {
                myCanvasRef.current.setInitialStrokes(myStrokes);
            }
        }, 100);
        
        const oppId = Object.keys(scores).find(id => id !== newSocket.id);
        if (oppId && scores[oppId] !== undefined) {
            setOpponentScore(scores[oppId]);
        }
    });

    newSocket.on('gameStarted', ({ endTime }) => {
        setEndTime(endTime);
        setGameStatus('playing');
    });

    newSocket.on('gameOver', ({ scores }) => {
        setGameStatus('finished');
        if (scores) {
           if (scores[newSocket.id] !== undefined) setMyScore(scores[newSocket.id]);
           const oppId = Object.keys(scores).find(id => id !== newSocket.id);
           if (oppId && scores[oppId] !== undefined) setOpponentScore(scores[oppId]);
        }
        
        // Generate diffs
        setTimeout(() => {
            if (referenceCanvasRef.current) {
                if (myCanvasRef.current) {
                    const myDiff = generateDiffOverlay(myCanvasRef.current.getCanvas(), referenceCanvasRef.current);
                    if (myDiff) setMyDiffUrl(myDiff);
                }
                if (oppCanvasRef.current) {
                    const oppDiff = generateDiffOverlay(oppCanvasRef.current.getCanvas(), referenceCanvasRef.current);
                    if (oppDiff) setOppDiffUrl(oppDiff);
                }
            }
        }, 100);
    });

    newSocket.on('drawData', ({ strokeData }) => {
        if (oppCanvasRef.current) {
            oppCanvasRef.current.addExternalStroke(strokeData);
        }
    });
    
    newSocket.on('undoStroke', ({ playerId, strokeId }) => {
        if (oppCanvasRef.current) {
            oppCanvasRef.current.remoteUndo(strokeId);
        }
    });

    newSocket.on('clearCanvas', ({ playerId }) => {
        if (oppCanvasRef.current) {
            oppCanvasRef.current.remoteClear();
        }
    });

    newSocket.on('scoreUpdate', ({ score }) => {
        setOpponentScore(score);
    });

    newSocket.on('waitingForRematch', () => setRematchStatus('waiting'));
    newSocket.on('opponentWantsRematch', () => setRematchStatus('opponent_waiting'));

    newSocket.on('restartMatch', ({ referenceImage, endTime }) => {
        setRematchStatus('');
        setCurrentImage(referenceImage);
        setIsImageLoading(true);
        setMyScore(0);
        setOpponentScore(0);
        setMyDiffUrl(null);
        setOppDiffUrl(null);
        setOpponentLeft(false);
        setOpponentDisconnected(false);
        setEndTime(endTime);
        setZoom(1);
        setShowGrid(false);
        setGameStatus('playing');
        
        if (myCanvasRef.current) myCanvasRef.current.remoteClear();
        if (oppCanvasRef.current) oppCanvasRef.current.remoteClear();
    });

    newSocket.on('opponentLeft', ({ forfeited }) => {
        if (forfeited) {
            setGameStatus('finished');
            setOpponentLeft(true);
            setOpponentScore(0);
            setTimeLeft(0);
            setEndTime(null);
            
            // Generate diff just for the local player since opponent left
            setTimeout(() => {
                if (referenceCanvasRef.current && myCanvasRef.current) {
                    const myDiff = generateDiffOverlay(myCanvasRef.current.getCanvas(), referenceCanvasRef.current);
                    if (myDiff) setMyDiffUrl(myDiff);
                }
            }, 100);
        } else {
            // Game already ended, opponent just left the lobby
            setOpponentDisconnected(true);
        }
    });

    return () => newSocket.close();
  }, []);

  useEffect(() => {
    let interval;
    if (gameStatus === 'playing' && endTime) {
        interval = setInterval(() => {
            const remaining = Math.max(0, Math.floor((endTime - Date.now()) / 1000));
            setTimeLeft(remaining);
            if (remaining > 0 && remaining <= 10) {
                playTick();
            }
            if (remaining <= 0) {
                clearInterval(interval);
            }
        }, 1000);
    }
    return () => clearInterval(interval);
  }, [endTime, gameStatus]);

  useEffect(() => {
      if (gameStatus === 'finished') {
          if (myScore > opponentScore || opponentLeft) {
              playWin();
          } else if (opponentScore > myScore && !opponentLeft) {
              playLose();
          } else {
              playWin(); // Draw sound is same as win for now
          }
      }
  }, [gameStatus, myScore, opponentScore, opponentLeft]);

  const handleImageUpload = (e) => {
      const file = e.target.files[0];
      if (file) {
          const reader = new FileReader();
          reader.onload = (event) => setCustomImageDataUrl(event.target.result);
          reader.readAsDataURL(file);
      }
  };

  const createGame = async () => {
    if (gameCategory === 'custom' && !customImageDataUrl) {
        alert('Please select an image first!');
        return;
    }
    
    const room = Math.random().toString(36).substring(2, 8).toUpperCase();
    let finalImageUrl = '';
    
    if (gameCategory === 'custom') {
        try {
            const res = await fetch('/api/upload-image', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image: customImageDataUrl })
            });
            const data = await res.json();
            finalImageUrl = `/api/custom-image/${data.id}`;
        } catch (e) {
            console.error('Failed to upload custom image:', e);
            return;
        }
    } else {
        const seed = Math.random().toString(36).substring(2, 10);
        const aiImageUrl = `https://api.dicebear.com/7.x/${gameCategory}/svg?seed=${seed}&backgroundColor=e2e8f0,f8fafc,fef08a,fbcfe8,bfdbfe`;
        finalImageUrl = `/api/proxy-image?url=${encodeURIComponent(aiImageUrl)}`;
    }
    
    setRoomId(room);
    setCurrentImage(finalImageUrl);
    setIsImageLoading(true);
    setInGame(true);
    setGameStatus('waiting');
    
    if (socket) {
        socket.emit('joinRoom', { roomId: room, imageSrc: finalImageUrl, category: gameCategory });
    }
  };

  const joinGame = () => {
    if (!joinRoomId) return;
    
    if (socket) {
        socket.emit('checkRoom', joinRoomId.toUpperCase(), (response) => {
            if (response === true || response.exists) {
                setJoinError('');
                setRoomId(joinRoomId.toUpperCase());
                setIsImageLoading(true);
                setInGame(true);
                setGameStatus('waiting');
            } else {
                setJoinError(response.error || "Room does not exist! Check the code and try again.");
            }
        });
    }
  };

  // Emit joinRoom only after inGame is true and components are mounted
  useEffect(() => {
      if (inGame && socket && roomId) {
          socket.emit('joinRoom', { roomId, imageSrc: currentImage });
      }
  }, [inGame, socket, roomId]);

  const displayZoom = gameStatus === 'finished' ? 1 : zoom;

  const handleImageLoad = () => {
    const img = referenceImgRef.current;
    if (img && referenceCanvasRef.current) {
        try {
            const ctx = referenceCanvasRef.current.getContext('2d', { willReadFrequently: true });
            
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, 400, 300);
            ctx.drawImage(img, 0, -50, 400, 400);

            const baseline = calculateBaseline(referenceCanvasRef.current);
            setBaselineScore(baseline);

            const extractedColors = extractColorsFromCanvas(referenceCanvasRef.current, 8);
            setColors(extractedColors);
            setColor(extractedColors[0]);
        } catch (e) {
            console.error('Failed to process image:', e);
        } finally {
            setIsImageLoading(false);
        }
    }
  };

  const handleImageError = () => {
     // If the API fails, randomly fallback to one of our 10 beautifully curated default images, deterministically chosen by roomId so both players see the same image
     console.warn('Failed to load AI image. Falling back to deterministic default based on room ID.');
     let hash = 0;
     const idToHash = roomId || 'default';
     for (let i = 0; i < idToHash.length; i++) {
         hash = idToHash.charCodeAt(i) + ((hash << 5) - hash);
     }
     const index = (Math.abs(hash) % 10) + 1;
     setCurrentImage(`/reference_${index}.png`);
  };

  const handleReferenceClick = (e) => {
    if (!isEyedropper || !referenceCanvasRef.current) return;
    
    // Get click coordinates relative to the image
    const rect = e.target.getBoundingClientRect();
    const x = Math.floor(e.clientX - rect.left);
    const y = Math.floor(e.clientY - rect.top);
    
    // Scale coordinates since CSS might scale the image, though here it's 400x300
    const scaleX = 400 / rect.width;
    const scaleY = 300 / rect.height;
    
    const canvasX = Math.floor(x * scaleX);
    const canvasY = Math.floor(y * scaleY);

    const ctx = referenceCanvasRef.current.getContext('2d');
    const pixel = ctx.getImageData(canvasX, canvasY, 1, 1).data;
    const hex = "#" + (1 << 24 | pixel[0] << 16 | pixel[1] << 8 | pixel[2]).toString(16).slice(1).toUpperCase();
    
    setColor(hex);
    setIsEyedropper(false);
    setIsEraser(false);
    
    if (!colors.includes(hex)) {
       setColors(prev => [...prev, hex]);
    }
  };


  const updateMyScore = (score) => {
      setMyScore(score);
      if (socket && roomId) {
          socket.emit('scoreUpdate', { roomId, score });
      }
  };

  if (!inGame) {
    return (
      <div className="app-container" style={{ justifyContent: 'center', alignItems: 'center' }}>
        <div className="glass-panel" style={{ padding: '40px', textAlign: 'center', minWidth: '350px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '20px' }}>
             <img src="/logo.png" alt="DrawMatch Logo" style={{ width: '80px', height: '80px', borderRadius: '18px', marginBottom: '15px', boxShadow: '0 8px 25px rgba(0,0,0,0.3)' }} />
             <h1 style={{ fontSize: '3rem', margin: 0 }}>DrawMatch</h1>
          </div>
          <p style={{ marginBottom: '30px', color: 'var(--text-secondary)' }}>Can you copy the masterpiece?</p>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
            <div style={{ display: 'flex', gap: '10px' }}>
                <select 
                    value={gameCategory} 
                    onChange={(e) => setGameCategory(e.target.value)}
                    style={{ padding: '12px 15px', borderRadius: '8px', border: 'none', flex: 1, outline: 'none', background: 'rgba(255,255,255,0.1)', color: 'white', fontSize: '1rem', cursor: 'pointer' }}
                >
                    <option value="shapes" style={{color: 'black'}}>Abstract Shapes</option>
                    <option value="pixel-art" style={{color: 'black'}}>Pixel Art</option>
                    <option value="avataaars" style={{color: 'black'}}>Avatars</option>
                    <option value="bottts" style={{color: 'black'}}>Robots</option>
                    <option value="adventurer" style={{color: 'black'}}>Adventurer</option>
                    <option value="croodles" style={{color: 'black'}}>Croodles</option>
                    <option value="identicon" style={{color: 'black'}}>Identicons</option>
                    <option value="micah" style={{color: 'black'}}>Micah</option>
                    <option value="miniavs" style={{color: 'black'}}>Mini Avatars</option>
                    <option value="open-peeps" style={{color: 'black'}}>Open Peeps</option>
                    <option value="personas" style={{color: 'black'}}>Personas</option>
                    <option value="custom" style={{color: 'black'}}>Upload Custom Image</option>
                </select>
            </div>
            
            {gameCategory === 'custom' && (
                <div style={{ background: 'rgba(255,255,255,0.05)', padding: '15px', borderRadius: '8px', border: '1px dashed rgba(255,255,255,0.2)' }}>
                    <input 
                        type="file" 
                        accept="image/*" 
                        onChange={handleImageUpload} 
                        style={{ color: 'white' }}
                    />
                    {customImageDataUrl && (
                        <div style={{ marginTop: '10px', fontSize: '0.9rem', color: '#10b981' }}>✓ Image loaded successfully</div>
                    )}
                </div>
            )}
            
            <button className="btn" onClick={createGame}>Create New Game</button>
            
            <div style={{ margin: '15px 0', borderBottom: '1px solid var(--border-color)' }}></div>
            
            <div style={{ position: 'relative', display: 'flex', gap: '10px' }}>
              <input 
                type="text" 
                placeholder="Enter Room Code" 
                value={joinRoomId}
                onChange={(e) => {
                    setJoinRoomId(e.target.value);
                    if (joinError) setJoinError('');
                }}
                style={{ padding: '12px 15px', borderRadius: '8px', border: 'none', flex: 1, outline: 'none', background: 'rgba(255,255,255,0.1)', color: 'white', fontSize: '1rem', border: joinError ? '1px solid var(--danger)' : '1px solid transparent', transition: 'border 0.2s' }}
              />
              <button className="btn" onClick={joinGame} style={{ background: 'var(--success)' }}>Join</button>
              
              {joinError && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: '8px', padding: '10px 15px', background: 'rgba(239, 68, 68, 0.95)', backdropFilter: 'blur(4px)', border: '1px solid #f87171', borderRadius: '8px', color: 'white', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '10px', textAlign: 'left', animation: 'fadeIn 0.3s ease', zIndex: 10, boxShadow: '0 4px 15px rgba(239, 68, 68, 0.4)' }}>
                  <span style={{ fontSize: '1.2rem' }}>⚠️</span>
                  {joinError}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }



  const formatTime = (seconds) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="app-container">
      <div className="header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        {gameStatus === 'finished' ? (
           <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', animation: 'fadeIn 0.5s ease' }}>
              <h2 style={{ fontSize: '2.5rem', color: '#cbd5e1', letterSpacing: '10px', fontWeight: '300', margin: '20px 0 10px 0', textTransform: 'uppercase' }}>{opponentLeft ? 'Opponent Forfeited' : "Time's Up"}</h2>
              {(!opponentLeft && !opponentDisconnected) ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
                    {rematchStatus === 'opponent_waiting' && (
                        <div style={{ color: 'var(--accent)', fontWeight: 'bold', animation: 'pulse 2s infinite' }}>Opponent wants a rematch!</div>
                    )}
                    <div style={{ display: 'flex', gap: '15px' }}>
                        <button 
                            className="btn" 
                            onClick={() => {
                                if (rematchStatus !== 'waiting') socket.emit('playAgain', { roomId });
                            }} 
                            disabled={rematchStatus === 'waiting'}
                            style={{ 
                                padding: '10px 40px', fontSize: '1.2rem', borderRadius: '30px', 
                                background: rematchStatus === 'waiting' ? 'rgba(255,255,255,0.2)' : 'var(--success)',
                                cursor: rematchStatus === 'waiting' ? 'not-allowed' : 'pointer'
                            }}
                        >
                            {rematchStatus === 'waiting' ? 'Waiting for opponent...' : 'Play Again'}
                        </button>
                        
                        <button 
                            className="btn" 
                            onClick={() => window.location.reload()}
                            style={{ 
                                padding: '10px 40px', fontSize: '1.2rem', borderRadius: '30px', 
                                background: 'transparent', border: '1px solid rgba(255,255,255,0.3)',
                                color: 'white', cursor: 'pointer'
                            }}
                            onMouseOver={e => e.currentTarget.style.background='rgba(255,255,255,0.1)'} 
                            onMouseOut={e => e.currentTarget.style.background='transparent'}
                        >
                            Leave Room
                        </button>
                    </div>
                </div>
              ) : (
                <button className="btn" onClick={() => window.location.reload()} style={{ padding: '10px 40px', fontSize: '1.2rem', borderRadius: '30px', background: 'var(--accent)' }}>Back to Lobby</button>
              )}
           </div>
        ) : (
           <>
             <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                <img src="/logo.png" alt="DrawMatch Logo" style={{ width: '45px', height: '45px', borderRadius: '10px' }} />
                 <div>
                   <h1 style={{ margin: 0 }}>DrawMatch</h1>
                   <div style={{ display: 'flex', alignItems: 'center', gap: '8px', opacity: 0.8, marginTop: '2px' }}>
                     <p style={{ margin: 0 }}>Room: {roomId}</p>
                     <button onClick={copyRoomCode} style={{ background: 'transparent', border: 'none', color: 'white', cursor: 'pointer', padding: '2px' }} title="Copy Room Code">
                        {copied ? (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                        ) : (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                        )}
                     </button>
                   </div>
                 </div>
             </div>
             <div style={{ fontSize: '2rem', fontWeight: 'bold', color: timeLeft <= 10 ? 'var(--danger)' : 'white' }}>
                {endTime ? formatTime(timeLeft) : 'Waiting...'}
             </div>
             <button 
               className="btn" 
               onClick={() => setShowGrid(!showGrid)}
               style={{ background: showGrid ? 'var(--accent)' : 'var(--panel-bg)' }}
             >
               {showGrid ? 'Hide Grid' : 'Show Grid'}
             </button>
           </>
        )}
      </div>

      <canvas ref={referenceCanvasRef} width={400} height={300} style={{ display: 'none' }} />

      <div className="game-area" style={{ position: 'relative', flexWrap: gameStatus === 'finished' ? 'nowrap' : 'wrap', transform: gameStatus === 'finished' ? 'scale(0.85)' : 'none', transition: 'all 0.5s ease', marginTop: gameStatus === 'finished' ? '-20px' : '0' }}>
        {isImageLoading && (
          <div style={{ position: 'absolute', inset: -20, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', background: 'var(--bg-color)', zIndex: 50, borderRadius: '16px' }}>
            <div style={{ width: '80px', height: '80px', border: '6px solid rgba(255,255,255,0.1)', borderTopColor: '#60a5fa', borderRightColor: '#c084fc', borderRadius: '50%', animation: 'spin 1s linear infinite', boxShadow: '0 0 20px rgba(96, 165, 250, 0.4)' }}></div>
            <h2 style={{ marginTop: '30px', fontSize: '2rem', background: 'linear-gradient(to right, #60a5fa, #c084fc)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>Generating AI Painting...</h2>
            <p style={{ marginTop: '15px', color: 'var(--text-secondary)' }}>Preparing your canvas...</p>
          </div>
        )}
        <div className="canvas-container">
          {gameStatus === 'finished' ? (
             <div style={{ position: 'relative', width: '100%', textAlign: 'left', marginBottom: '15px', animation: 'fadeIn 0.8s ease' }}>
                 <h2 style={{ fontSize: '4.5rem', margin: 0, fontWeight: '400', color: '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    {myScore}
                    {(myScore > opponentScore || opponentLeft) && (
                        <div style={{ color: '#ef4444', border: '4px solid #ef4444', borderRadius: '12px', padding: '5px 15px', fontSize: '2rem', fontWeight: '900', letterSpacing: '3px', transform: 'rotate(-8deg)', boxShadow: '0 4px 20px rgba(239, 68, 68, 0.3)', background: 'rgba(15,23,42,0.8)' }}>
                            WINNER!
                        </div>
                    )}
                    {(myScore === opponentScore && !opponentLeft) && (
                        <div style={{ color: '#f59e0b', border: '4px solid #f59e0b', borderRadius: '12px', padding: '5px 15px', fontSize: '2rem', fontWeight: '900', letterSpacing: '3px', transform: 'rotate(-8deg)', boxShadow: '0 4px 20px rgba(245, 158, 11, 0.3)', background: 'rgba(15,23,42,0.8)' }}>
                            DRAW!
                        </div>
                    )}
                 </h2>
             </div>
          ) : (
             <>
               <div style={{width: '100%', display: 'flex', justifyContent: 'space-between'}}>
                 <span>You</span>
                 <span>{myScore}% Match</span>
               </div>
               <div className="accuracy-bar-container">
                 <div className="accuracy-bar" style={{ width: `${myScore}%` }}></div>
               </div>
             </>
          )}
          <div ref={canvasScrollRef} onScroll={handleCanvasScroll} style={{ width: '100%', maxWidth: '400px', maxHeight: '300px', overflow: 'auto', position: 'relative', scrollbarWidth: 'thin' }}>
            <div className="responsive-canvas-wrapper" style={{ width: `${displayZoom * 100}%`, maxWidth: 'none', transformOrigin: 'top left' }}>
              <Canvas 
                  ref={myCanvasRef}
                  isPlayer={gameStatus === 'playing'} 
                  color={isEraser ? 'rgba(255,255,255,1)' : hexToRgba(color, opacity)} 
                  brushSize={brushSize} 
                  socket={socket} 
                  roomId={roomId}
                  onScoreUpdate={updateMyScore}
                  referenceCanvasRef={referenceCanvasRef}
                  showGrid={showGrid && gameStatus !== 'finished'}
                  baselineScore={baselineScore}
                  isLineTool={isLineTool}
              />
              {gameStatus === 'waiting' && (
                <div style={{ position: 'absolute', inset: 0, background: 'rgba(15, 23, 42, 0.65)', backdropFilter: 'blur(3px)', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', zIndex: 10 }}>
                   <div style={{ width: '45px', height: '45px', border: '4px solid rgba(255,255,255,0.1)', borderTopColor: '#60a5fa', borderRadius: '50%', animation: 'spin 1s linear infinite', marginBottom: '15px' }}></div>
                   <h3 style={{ color: 'white', textShadow: '0 2px 4px rgba(0,0,0,0.5)', marginBottom: '8px', fontSize: '1.3rem' }}>Waiting for Opponent...</h3>
                   <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--text-secondary)', fontSize: '1rem' }}>
                      <span>Room Code:</span> 
                      <strong style={{color: 'white', background: 'rgba(255,255,255,0.15)', padding: '3px 8px', borderRadius: '6px', letterSpacing: '1px'}}>{roomId}</strong>
                      <button 
                          onClick={copyRoomCode} 
                          style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: copied ? '#10b981' : 'white', cursor: 'pointer', padding: '6px', borderRadius: '6px', display: 'flex', alignItems: 'center', transition: 'all 0.2s' }}
                          onMouseOver={e => e.currentTarget.style.background='rgba(255,255,255,0.2)'}
                          onMouseOut={e => e.currentTarget.style.background='rgba(255,255,255,0.1)'}
                          title="Copy Room Code"
                      >
                          {copied ? (
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                          ) : (
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                          )}
                      </button>
                   </div>
                </div>
              )}
              {gameStatus === 'finished' && myDiffUrl && (
                  <img src={myDiffUrl} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 20, animation: 'fadeIn 1s ease 0.5s forwards', opacity: 0 }} alt="Error Highlight" />
              )}
            </div>
          </div>
          
          {gameStatus !== 'finished' && (
            <div className="toolbar-container" style={{ display: 'flex', flexWrap: 'wrap', gap: '15px', width: '100%', maxWidth: '400px', justifyContent: 'center', marginTop: '15px' }}>
            
            {/* Color Dock */}
            <div className="glass-panel color-picker" style={{ display: 'flex', gap: '10px', alignItems: 'center', padding: '10px 16px', borderRadius: '30px', overflowX: 'auto', maxWidth: '100%', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 8px 32px rgba(0,0,0,0.3)' }}>
              {colors.map((c, i) => (
                <div 
                  key={i}
                  style={{ backgroundColor: c, flexShrink: 0, width: '26px', height: '26px', border: color === c ? '2px solid white' : '2px solid transparent', transform: color === c ? 'scale(1.1)' : 'none', transition: 'all 0.2s', cursor: 'pointer', borderRadius: '50%' }}
                  onClick={() => { setColor(c); playClick(); }}
                  title={c}
                />
              ))}
              <div style={{ width: '1px', height: '20px', background: 'rgba(255,255,255,0.2)', margin: '0 5px', flexShrink: 0 }}></div>
              <button 
                onClick={() => setIsEyedropper(!isEyedropper)}
                style={{ 
                    width: '28px', height: '28px', borderRadius: '50%', 
                    background: isEyedropper ? 'var(--accent)' : 'transparent', 
                    color: isEyedropper ? 'white' : 'var(--text-secondary)',
                    border: 'none', cursor: 'pointer',
                    display: 'flex', justifyContent: 'center', alignItems: 'center',
                    fontSize: '14px', flexShrink: 0, transition: 'all 0.2s',
                }}
                title="Pick color from painting"
              >
                💧
              </button>
            </div>
            
            {/* Sliders Dock */}
            <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '12px 16px', borderRadius: '20px', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 8px 32px rgba(0,0,0,0.3)', flexGrow: 1 }}>
                {/* Size Slider */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontSize: '12px', color: 'var(--text-secondary)', width: '40px' }}>Size</span>
                    <input 
                        type="range" min="1" max="50" value={brushSize} 
                        onChange={(e) => setBrushSize(parseInt(e.target.value))}
                        style={{ flex: 1, accentColor: 'var(--accent)' }}
                    />
                    <div style={{ width: '20px', height: '20px', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                        <div style={{ width: Math.min(brushSize, 20), height: Math.min(brushSize, 20), background: color === '#FFFFFF' ? '#ccc' : color, borderRadius: '50%' }}></div>
                    </div>
                </div>
                {/* Opacity Slider */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontSize: '12px', color: 'var(--text-secondary)', width: '40px' }}>Alpha</span>
                    <input 
                        type="range" min="0.05" max="1" step="0.05" value={opacity} 
                        onChange={(e) => setOpacity(parseFloat(e.target.value))}
                        style={{ flex: 1, accentColor: 'var(--accent)' }}
                    />
                    <span style={{ fontSize: '12px', color: 'white', width: '20px', textAlign: 'right' }}>{Math.round(opacity * 100)}%</span>
                </div>
                {/* Zoom Slider */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontSize: '12px', color: 'var(--text-secondary)', width: '40px' }}>Zoom</span>
                    <input 
                        type="range" min="1" max="3" step="0.1" value={zoom} 
                        onChange={(e) => setZoom(parseFloat(e.target.value))}
                        style={{ flex: 1, accentColor: 'var(--accent)' }}
                    />
                    <span style={{ fontSize: '12px', color: 'white', width: '20px', textAlign: 'right' }}>{Math.round(zoom * 100)}%</span>
                </div>
            </div>

            {/* Action Dock */}
            <div className="glass-panel" style={{ display: 'flex', gap: '10px', alignItems: 'center', padding: '8px 12px', borderRadius: '30px', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 8px 32px rgba(0,0,0,0.3)' }}>
                  <button onClick={() => setIsEraser(!isEraser)} style={{ padding: '8px 14px', background: isEraser ? 'rgba(255,255,255,0.2)' : 'transparent', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '20px', display: 'flex', alignItems: 'center', gap: '6px', color: 'white', fontSize: '0.9rem', cursor: 'pointer', transition: 'background 0.2s' }}>
                    🧼 Eraser
                  </button>
                  <button onClick={() => setIsLineTool(!isLineTool)} style={{ padding: '8px 14px', background: isLineTool ? 'rgba(255,255,255,0.2)' : 'transparent', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '20px', display: 'flex', alignItems: 'center', gap: '6px', color: 'white', fontSize: '0.9rem', cursor: 'pointer', transition: 'background 0.2s' }}>
                    📏 Line
                  </button>
                  <button onClick={() => { myCanvasRef.current?.undo(); playClick(); }} style={{ padding: '8px 14px', background: 'transparent', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '20px', display: 'flex', alignItems: 'center', gap: '6px', color: 'white', fontSize: '0.9rem', cursor: 'pointer', transition: 'background 0.2s' }} onMouseOver={e => e.currentTarget.style.background='rgba(255,255,255,0.1)'} onMouseOut={e => e.currentTarget.style.background='transparent'}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>
                    Undo
                  </button>
                  <button onClick={() => { myCanvasRef.current?.clear(); playClick(); }} style={{ padding: '8px 14px', background: 'linear-gradient(135deg, #ef4444, #dc2626)', border: 'none', borderRadius: '20px', display: 'flex', alignItems: 'center', gap: '6px', color: 'white', fontSize: '0.9rem', cursor: 'pointer', boxShadow: '0 4px 10px rgba(239,68,68,0.3)' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    Clear
                  </button>
            </div>
          </div>
          )}
        </div>

        <div className="reference-container" style={{ cursor: isEyedropper ? 'crosshair' : 'default', width: '100%', maxWidth: '400px', display: 'flex', justifyContent: 'center', position: 'relative' }} onClick={handleReferenceClick}>
          <div ref={refScrollRef} onScroll={handleRefScroll} style={{ width: '100%', maxHeight: '300px', overflow: 'auto', scrollbarWidth: 'thin' }}>
            <img 
                ref={referenceImgRef}
                src={currentImage}
                alt="Reference" 
                className="responsive-reference"
                style={{ opacity: isImageLoading ? 0 : 1, transition: 'opacity 0.3s', width: `${displayZoom * 100}%`, maxWidth: 'none' }}
                crossOrigin="anonymous"
                onLoad={handleImageLoad}
                onError={handleImageError}
            />
          </div>
          {showGrid && !isImageLoading && gameStatus !== 'finished' && <div className="grid-overlay"></div>}
        </div>

        <div className="canvas-container">
          {gameStatus === 'finished' ? (
             <div style={{ position: 'relative', width: '100%', textAlign: 'left', marginBottom: '15px', animation: 'fadeIn 0.8s ease' }}>
                 <h2 style={{ fontSize: '4.5rem', margin: 0, fontWeight: '400', color: '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    {opponentScore}
                    {opponentScore > myScore && !opponentLeft && (
                        <div style={{ color: '#ef4444', border: '4px solid #ef4444', borderRadius: '12px', padding: '5px 15px', fontSize: '2rem', fontWeight: '900', letterSpacing: '3px', transform: 'rotate(8deg)', boxShadow: '0 4px 20px rgba(239, 68, 68, 0.3)', background: 'rgba(15,23,42,0.8)' }}>
                            WINNER!
                        </div>
                    )}
                    {(myScore === opponentScore && !opponentLeft) && (
                        <div style={{ color: '#f59e0b', border: '4px solid #f59e0b', borderRadius: '12px', padding: '5px 15px', fontSize: '2rem', fontWeight: '900', letterSpacing: '3px', transform: 'rotate(8deg)', boxShadow: '0 4px 20px rgba(245, 158, 11, 0.3)', background: 'rgba(15,23,42,0.8)' }}>
                            DRAW!
                        </div>
                    )}
                 </h2>
             </div>
          ) : (
             <>
               <div style={{width: '100%', display: 'flex', justifyContent: 'space-between'}}>
                 <span>Opponent</span>
                 <span>{opponentScore}% Match</span>
               </div>
               <div className="accuracy-bar-container">
                 <div className="accuracy-bar" style={{ width: `${opponentScore}%` }}></div>
               </div>
             </>
          )}
          <div className="responsive-canvas-wrapper">
             {gameStatus === 'finished' && oppDiffUrl && (
                <img src={oppDiffUrl} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 20, animation: 'fadeIn 1s ease 0.5s forwards', opacity: 0 }} alt="Error Highlight" />
             )}
            <Canvas 
                ref={oppCanvasRef}
                isPlayer={false} 
                color="#000" 
                brushSize={10} 
                showGrid={showGrid && gameStatus !== 'finished'}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
