import React, { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { io } from 'socket.io-client';
import { calculateSimilarity, calculateBaseline, generateDiffOverlay } from './utils/imageCompare';
import { extractColorsFromCanvas } from './utils/extractColors';

const Canvas = forwardRef(({ isPlayer, color, brushSize, socket, roomId, onScoreUpdate, referenceCanvasRef, showGrid, baselineScore }, ref) => {
  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const lastPos = useRef(null);
  const currentStrokeId = useRef(null);
  const strokesHistory = useRef([]);

  const redrawCanvas = (strokes) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    strokes.forEach(stroke => {
      ctx.beginPath();
      ctx.moveTo(stroke.startX, stroke.startY);
      ctx.lineTo(stroke.endX, stroke.endY);
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.size;
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
       const ctx = canvasRef.current.getContext('2d');
       ctx.beginPath();
       ctx.moveTo(stroke.startX, stroke.startY);
       ctx.lineTo(stroke.endX, stroke.endY);
       ctx.strokeStyle = stroke.color;
       ctx.lineWidth = stroke.size;
       ctx.lineCap = 'round';
       ctx.lineJoin = 'round';
       ctx.stroke();
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

  const startDrawing = (e) => {
    if (!isPlayer) return;
    e.target.setPointerCapture(e.pointerId);
    const { offsetX, offsetY } = e.nativeEvent;
    lastPos.current = { x: offsetX, y: offsetY };
    currentStrokeId.current = Math.random().toString(36).substr(2, 9);
    setIsDrawing(true);
  };

  const draw = (e) => {
    if (!isDrawing || !isPlayer) return;
    const { offsetX, offsetY } = e.nativeEvent;
    const ctx = canvasRef.current.getContext('2d');
    
    ctx.beginPath();
    ctx.moveTo(lastPos.current.x, lastPos.current.y);
    ctx.lineTo(offsetX, offsetY);
    ctx.strokeStyle = color;
    ctx.lineWidth = brushSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();

    const strokeObj = {
        strokeId: currentStrokeId.current,
        startX: lastPos.current.x,
        startY: lastPos.current.y,
        endX: offsetX,
        endY: offsetY,
        color,
        size: brushSize
    };
    strokesHistory.current.push(strokeObj);

    if (socket && roomId) {
      socket.emit('drawData', {
        roomId,
        strokeData: strokeObj
      });
    }

    lastPos.current = { x: offsetX, y: offsetY };
  };

  const endDrawing = (e) => {
    if (!isPlayer) return;
    if (e && e.target && e.pointerId) {
        e.target.releasePointerCapture(e.pointerId);
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
  const [brushSize, setBrushSize] = useState(10);
  const [showGrid, setShowGrid] = useState(false);
  const [isEyedropper, setIsEyedropper] = useState(false);
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
  
  const referenceImgRef = useRef(null);
  const referenceCanvasRef = useRef(null); 
  const myCanvasRef = useRef(null);
  const oppCanvasRef = useRef(null);

  // Dynamic colors array starting with basics, populated on image load
  const [colors, setColors] = useState(['#000000', '#FFFFFF']);

  useEffect(() => {
    // Connect to local server
    const newSocket = io('http://localhost:3001');
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

    return () => newSocket.close();
  }, []);

  useEffect(() => {
    if (endTime && gameStatus === 'playing') {
      const interval = setInterval(() => {
        const remaining = Math.max(0, Math.floor((endTime - Date.now()) / 1000));
        setTimeLeft(remaining);
        if (remaining <= 0) {
            clearInterval(interval);
        }
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [endTime, gameStatus]);

  const createGame = () => {
    const room = Math.random().toString(36).substring(2, 8).toUpperCase();
    
    // Randomly pick one of our 10 beautifully curated reference images
    const randomImageIndex = Math.floor(Math.random() * 10) + 1;
    const aiImageUrl = `/reference_${randomImageIndex}.png`;
    
    setRoomId(room);
    setCurrentImage(aiImageUrl);
    setIsImageLoading(true);
    setInGame(true);
    setGameStatus('waiting');
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

  const handleImageLoad = () => {
    const img = referenceImgRef.current;
    if (img && referenceCanvasRef.current) {
        const ctx = referenceCanvasRef.current.getContext('2d', { willReadFrequently: true });
        
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, 400, 300);
        // DiceBear returns 400x400 square images. 
        // Our canvas is 400x300, and our <img> has object-fit: cover, which trims 50px from top and bottom.
        // So we draw the image at Y=-50 with height=400 to achieve the exact same mathematical crop on the hidden canvas.
        ctx.drawImage(img, 0, -50, 400, 400);

        // Calculate baseline score (what a blank white canvas scores against this image)
        const baseline = calculateBaseline(referenceCanvasRef.current);
        setBaselineScore(baseline);

        // Dynamically extract dominant colors
        const extractedColors = extractColorsFromCanvas(referenceCanvasRef.current, 8);
        setColors(extractedColors);
        setColor(extractedColors[0]); // Set first color as active
        
        setIsImageLoading(false);
    }
  };

  const handleImageError = () => {
     // If the proxy or AI fails, immediately fallback to a built-in image
     console.warn('Failed to load AI image. Falling back to default.');
     setCurrentImage('/reference_1.png');
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
          <h1 style={{ fontSize: '3rem', marginBottom: '20px' }}>DrawMatch</h1>
          <p style={{ marginBottom: '30px', color: 'var(--text-secondary)' }}>Can you copy the masterpiece?</p>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
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
              <h2 style={{ fontSize: '2.5rem', color: '#cbd5e1', letterSpacing: '10px', fontWeight: '300', margin: '20px 0 10px 0', textTransform: 'uppercase' }}>Time's Up</h2>
              <button className="btn" onClick={() => window.location.reload()} style={{ padding: '10px 40px', fontSize: '1.2rem', borderRadius: '30px', background: 'var(--success)' }}>Play Again</button>
           </div>
        ) : (
           <>
             <div>
                <h1>DrawMatch</h1>
                <p>Room: {roomId}</p>
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
                    {myScore > opponentScore && (
                        <div style={{ color: '#ef4444', border: '4px solid #ef4444', borderRadius: '12px', padding: '5px 15px', fontSize: '2rem', fontWeight: '900', letterSpacing: '3px', transform: 'rotate(-8deg)', boxShadow: '0 4px 20px rgba(239, 68, 68, 0.3)', background: 'rgba(15,23,42,0.8)' }}>
                            WINNER!
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
          <div className="canvas-wrapper" style={{ width: 400, height: 300, position: 'relative' }}>
            <Canvas 
                ref={myCanvasRef}
                isPlayer={gameStatus === 'playing'} 
                color={color} 
                brushSize={brushSize} 
                socket={socket} 
                roomId={roomId}
                onScoreUpdate={updateMyScore}
                referenceCanvasRef={referenceCanvasRef}
                showGrid={showGrid}
                baselineScore={baselineScore}
            />
            {gameStatus === 'waiting' && (
              <div style={{ position: 'absolute', inset: 0, background: 'rgba(15, 23, 42, 0.65)', backdropFilter: 'blur(3px)', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', zIndex: 10 }}>
                 <div style={{ width: '45px', height: '45px', border: '4px solid rgba(255,255,255,0.1)', borderTopColor: '#60a5fa', borderRadius: '50%', animation: 'spin 1s linear infinite', marginBottom: '15px' }}></div>
                 <h3 style={{ color: 'white', textShadow: '0 2px 4px rgba(0,0,0,0.5)', marginBottom: '8px', fontSize: '1.3rem' }}>Waiting for Opponent...</h3>
                 <p style={{ color: 'var(--text-secondary)', fontSize: '1rem' }}>Room Code: <strong style={{color: 'white', background: 'rgba(255,255,255,0.15)', padding: '3px 8px', borderRadius: '6px', letterSpacing: '1px'}}>{roomId}</strong></p>
              </div>
            )}
            {gameStatus === 'finished' && myDiffUrl && (
                <img src={myDiffUrl} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 20, animation: 'fadeIn 1s ease 0.5s forwards', opacity: 0 }} alt="Error Highlight" />
            )}
          </div>
          
          {gameStatus !== 'finished' && (
            <div className="toolbar-container" style={{ display: 'flex', flexWrap: 'wrap', gap: '15px', width: '100%', maxWidth: '400px', justifyContent: 'center', marginTop: '15px' }}>
            
            {/* Color Dock */}
            <div className="glass-panel color-picker" style={{ display: 'flex', gap: '10px', alignItems: 'center', padding: '10px 16px', borderRadius: '30px', overflowX: 'auto', maxWidth: '100%', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 8px 32px rgba(0,0,0,0.3)' }}>
              {colors.map((c, i) => (
                <div 
                  key={i}
                  style={{ backgroundColor: c, flexShrink: 0, width: '26px', height: '26px', border: color === c ? '2px solid white' : '2px solid transparent', transform: color === c ? 'scale(1.1)' : 'none', transition: 'all 0.2s', cursor: 'pointer', borderRadius: '50%' }}
                  onClick={() => setColor(c)}
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
            
            {/* Brush Dock */}
            <div className="glass-panel" style={{ display: 'flex', gap: '8px', alignItems: 'center', padding: '8px 16px', borderRadius: '30px', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 8px 32px rgba(0,0,0,0.3)' }}>
                {[5, 15, 30].map(size => (
                  <button 
                    key={size}
                    onClick={() => setBrushSize(size)}
                    style={{ 
                        width: '32px', height: '32px', borderRadius: '50%', border: 'none',
                        background: brushSize === size ? 'rgba(255,255,255,0.1)' : 'transparent',
                        display: 'flex', justifyContent: 'center', alignItems: 'center',
                        cursor: 'pointer', transition: 'background 0.2s'
                    }}
                  >
                    <div style={{ width: size, height: size, background: color === '#FFFFFF' ? '#000' : color, borderRadius: '50%' }}></div>
                  </button>
                ))}
            </div>

            {/* Action Dock */}
            <div className="glass-panel" style={{ display: 'flex', gap: '10px', alignItems: 'center', padding: '8px 12px', borderRadius: '30px', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 8px 32px rgba(0,0,0,0.3)' }}>
                  <button onClick={() => myCanvasRef.current?.undo()} style={{ padding: '8px 14px', background: 'transparent', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '20px', display: 'flex', alignItems: 'center', gap: '6px', color: 'white', fontSize: '0.9rem', cursor: 'pointer', transition: 'background 0.2s' }} onMouseOver={e => e.currentTarget.style.background='rgba(255,255,255,0.1)'} onMouseOut={e => e.currentTarget.style.background='transparent'}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>
                    Undo
                  </button>
                  <button onClick={() => myCanvasRef.current?.clear()} style={{ padding: '8px 14px', background: 'linear-gradient(135deg, #ef4444, #dc2626)', border: 'none', borderRadius: '20px', display: 'flex', alignItems: 'center', gap: '6px', color: 'white', fontSize: '0.9rem', cursor: 'pointer', boxShadow: '0 4px 10px rgba(239,68,68,0.3)' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    Clear
                  </button>
            </div>
          </div>
          )}
        </div>

        <div className="reference-container" style={{ width: 400, height: 300, cursor: isEyedropper ? 'crosshair' : 'default', position: 'relative' }} onClick={handleReferenceClick}>
          <img 
              ref={referenceImgRef}
              src={currentImage}
              alt="Reference" 
              style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: isImageLoading ? 0 : 1, transition: 'opacity 0.3s' }}
              crossOrigin="anonymous"
              onLoad={handleImageLoad}
              onError={handleImageError}
          />
          {showGrid && !isImageLoading && <div className="grid-overlay"></div>}
        </div>

        <div className="canvas-container">
          {gameStatus === 'finished' ? (
             <div style={{ position: 'relative', width: '100%', textAlign: 'left', marginBottom: '15px', animation: 'fadeIn 0.8s ease' }}>
                 <h2 style={{ fontSize: '4.5rem', margin: 0, fontWeight: '400', color: '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    {opponentScore}
                    {opponentScore > myScore && (
                        <div style={{ color: '#ef4444', border: '4px solid #ef4444', borderRadius: '12px', padding: '5px 15px', fontSize: '2rem', fontWeight: '900', letterSpacing: '3px', transform: 'rotate(8deg)', boxShadow: '0 4px 20px rgba(239, 68, 68, 0.3)', background: 'rgba(15,23,42,0.8)' }}>
                            WINNER!
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
          <div className="canvas-wrapper" style={{ width: 400, height: 300, position: 'relative' }}>
             {gameStatus === 'finished' && oppDiffUrl && (
                <img src={oppDiffUrl} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 20, animation: 'fadeIn 1s ease 0.5s forwards', opacity: 0 }} alt="Error Highlight" />
             )}
            <Canvas 
                ref={oppCanvasRef}
                isPlayer={false} 
                color="#000" 
                brushSize={10} 
                showGrid={showGrid}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
