import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { calculateSimilarity, calculateBaseline } from './utils/imageCompare';
import { extractColorsFromCanvas } from './utils/extractColors';

const Canvas = ({ isPlayer, color, brushSize, socket, roomId, onScoreUpdate, referenceCanvasRef, externalStrokes, initialStrokes, showGrid, currentScore, baselineScore }) => {
  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const lastPos = useRef(null);

  // Initialize canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }, []);

  // Replay initial strokes if provided (for late joiners)
  useEffect(() => {
    if (!isPlayer && initialStrokes && initialStrokes.length > 0) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      // Briefly wait to ensure canvas is ready
      setTimeout(() => {
        initialStrokes.forEach(stroke => {
          ctx.beginPath();
          ctx.moveTo(stroke.startX, stroke.startY);
          ctx.lineTo(stroke.endX, stroke.endY);
          ctx.strokeStyle = stroke.color;
          ctx.lineWidth = stroke.size;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.stroke();
        });
      }, 50);
    }
  }, [initialStrokes, isPlayer]);

  // Handle incoming individual strokes from opponent
  useEffect(() => {
    if (!isPlayer && externalStrokes) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      ctx.beginPath();
      ctx.moveTo(externalStrokes.startX, externalStrokes.startY);
      ctx.lineTo(externalStrokes.endX, externalStrokes.endY);
      ctx.strokeStyle = externalStrokes.color;
      ctx.lineWidth = externalStrokes.size;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
  }, [externalStrokes, isPlayer]);

  const startDrawing = (e) => {
    if (!isPlayer) return;
    e.target.setPointerCapture(e.pointerId);
    const { offsetX, offsetY } = e.nativeEvent;
    lastPos.current = { x: offsetX, y: offsetY };
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

    if (socket && roomId) {
      socket.emit('drawData', {
        roomId,
        strokeData: {
          startX: lastPos.current.x,
          startY: lastPos.current.y,
          endX: offsetX,
          endY: offsetY,
          color,
          size: brushSize
        }
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
    
    // Calculate score after a stroke ends using the normalized baseline
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
};

function App() {
  const [socket, setSocket] = useState(null);
  const [roomId, setRoomId] = useState('');
  const [joinRoomId, setJoinRoomId] = useState('');
  const [inGame, setInGame] = useState(false);
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
  const [opponentStrokes, setOpponentStrokes] = useState(null);
  const [initialOpponentStrokes, setInitialOpponentStrokes] = useState([]);
  
  const referenceImgRef = useRef(null);
  const referenceCanvasRef = useRef(null); 

  // Dynamic colors array starting with basics, populated on image load
  const [colors, setColors] = useState(['#000000', '#FFFFFF']);

  useEffect(() => {
    // Connect to local server
    const newSocket = io('http://localhost:3001');
    setSocket(newSocket);
    
    newSocket.on('connect', () => {
        console.log('Connected to server');
    });

    newSocket.on('initialState', ({ strokes, scores, referenceImage }) => {
        if (referenceImage) {
            setCurrentImage(referenceImage);
            setIsImageLoading(true);
        }
        // Filter strokes that aren't ours
        const oppStrokes = strokes.filter(s => s.playerId !== newSocket.id);
        if (oppStrokes.length > 0) {
            setInitialOpponentStrokes(oppStrokes);
        }
        // Set opponent score if available
        const oppId = Object.keys(scores).find(id => id !== newSocket.id);
        if (oppId && scores[oppId] !== undefined) {
            setOpponentScore(scores[oppId]);
        }
    });

    newSocket.on('drawData', ({ strokeData }) => {
        setOpponentStrokes(strokeData);
    });

    newSocket.on('scoreUpdate', ({ score }) => {
        setOpponentScore(score);
    });

    return () => newSocket.close();
  }, []);

  const createGame = () => {
    const room = Math.random().toString(36).substring(2, 8).toUpperCase();
    
    const subjects = [
      'red apple', 'yellow banana', 'green tree', 'orange carrot', 
      'blue coffee mug', 'pink donut', 'yellow sun', 'purple flower', 
      'grey cat face', 'brown dog face', 'red car', 'blue house', 
      'yellow star', 'green leaf', 'red cherry', 'slice of watermelon'
    ];
    
    // Pick a random subject
    const subject = subjects[Math.floor(Math.random() * subjects.length)];
    // Create a strict prompt to ensure simple, flat, 2D art without hands/easels
    const prompt = `A very simple flat minimal 2d vector illustration of a ${subject}, centered, solid light colored background, no shading, no details, easy to draw, digital art`;
    
    const seed = Math.floor(Math.random() * 1000000);
    const encodedPrompt = encodeURIComponent(prompt);
    // pollinations.ai gives us a free, instant image generation API without keys
    const aiImageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=400&height=300&nologo=true&seed=${seed}`;
    
    // Proxy the image through our own backend to avoid strict browser CORS policies blocking the canvas from reading it
    const proxyUrl = `http://localhost:3001/api/proxy-image?url=${encodeURIComponent(aiImageUrl)}`;
    
    setRoomId(room);
    setCurrentImage(proxyUrl);
    setIsImageLoading(true);
    setInGame(true);
  };

  const joinGame = () => {
    if (!joinRoomId) return;
    
    if (socket) {
        socket.emit('checkRoom', joinRoomId.toUpperCase(), (exists) => {
            if (exists) {
                setJoinError('');
                setRoomId(joinRoomId.toUpperCase());
                setIsImageLoading(true);
                setInGame(true);
            } else {
                setJoinError("Room does not exist! Check the code and try again.");
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
        // Force the image into 400x300 regardless of original aspect ratio 
        // to ensure it perfectly matches the player canvas dimensions
        ctx.drawImage(img, 0, 0, 400, 300);

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

  return (
    <div className="app-container">
      <div className="header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
           <h1>DrawMatch</h1>
           <p>Room: {roomId}</p>
        </div>
        <button 
          className="btn" 
          onClick={() => setShowGrid(!showGrid)}
          style={{ background: showGrid ? 'var(--accent)' : 'var(--panel-bg)' }}
        >
          {showGrid ? 'Hide Grid' : 'Show Grid'}
        </button>
      </div>

      <canvas ref={referenceCanvasRef} width={400} height={300} style={{ display: 'none' }} />

      <div className="game-area" style={{ position: 'relative' }}>
        {isImageLoading && (
          <div style={{ position: 'absolute', inset: -20, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', background: 'var(--bg-color)', zIndex: 50, borderRadius: '16px' }}>
            <div style={{ width: '80px', height: '80px', border: '6px solid rgba(255,255,255,0.1)', borderTopColor: '#60a5fa', borderRightColor: '#c084fc', borderRadius: '50%', animation: 'spin 1s linear infinite', boxShadow: '0 0 20px rgba(96, 165, 250, 0.4)' }}></div>
            <h2 style={{ marginTop: '30px', fontSize: '2rem', background: 'linear-gradient(to right, #60a5fa, #c084fc)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>Generating AI Painting...</h2>
            <p style={{ marginTop: '15px', color: 'var(--text-secondary)' }}>Preparing your canvas...</p>
          </div>
        )}
        <div className="canvas-container">
          <div style={{width: '100%', display: 'flex', justifyContent: 'space-between'}}>
            <span>You</span>
            <span>{myScore}% Match</span>
          </div>
          <div className="accuracy-bar-container">
            <div className="accuracy-bar" style={{ width: `${myScore}%` }}></div>
          </div>
          <div className="canvas-wrapper" style={{ width: 400, height: 300, position: 'relative' }}>
            <Canvas 
                isPlayer={true} 
                color={color} 
                brushSize={brushSize} 
                socket={socket} 
                roomId={roomId}
                onScoreUpdate={updateMyScore}
                referenceCanvasRef={referenceCanvasRef}
                showGrid={showGrid}
                currentScore={myScore}
                baselineScore={baselineScore}
            />
          </div>
          
          <div className="toolbar glass-panel">
            <div className="color-picker" style={{ flexWrap: 'wrap', maxWidth: '180px' }}>
              {colors.map((c, i) => (
                <div 
                  key={i}
                  className={`color-btn ${color === c ? 'active' : ''}`}
                  style={{ backgroundColor: c }}
                  onClick={() => setColor(c)}
                  title={c}
                />
              ))}
              <button 
                onClick={() => setIsEyedropper(!isEyedropper)}
                style={{ 
                    width: '30px', height: '30px', borderRadius: '50%', 
                    background: isEyedropper ? 'white' : 'transparent', 
                    color: isEyedropper ? 'black' : 'white',
                    border: '2px solid white', cursor: 'pointer',
                    display: 'flex', justifyContent: 'center', alignItems: 'center',
                    fontSize: '12px'
                }}
                title="Pick color from painting"
              >
                💧
              </button>
            </div>
            <div className="brush-sizes">
              {[5, 15, 30].map(size => (
                <button 
                  key={size}
                  className={`size-btn ${brushSize === size ? 'active' : ''}`}
                  onClick={() => setBrushSize(size)}
                  style={{ width: '40px', height: '40px' }}
                >
                  <div className="size-dot" style={{ width: size, height: size, background: color === '#FFFFFF' ? '#000' : color }}></div>
                </button>
              ))}
            </div>
          </div>
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
          <div style={{width: '100%', display: 'flex', justifyContent: 'space-between'}}>
            <span>Opponent</span>
            <span>{opponentScore}% Match</span>
          </div>
          <div className="accuracy-bar-container">
            <div className="accuracy-bar" style={{ width: `${opponentScore}%` }}></div>
          </div>
          <div className="canvas-wrapper" style={{ width: 400, height: 300, position: 'relative' }}>
            <Canvas 
                isPlayer={false} 
                color="#000" 
                brushSize={10} 
                externalStrokes={opponentStrokes}
                initialStrokes={initialOpponentStrokes}
                showGrid={showGrid}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
