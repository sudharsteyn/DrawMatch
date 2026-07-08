const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const imageCache = {};

app.get('/api/proxy-image', async (req, res) => {
    const url = req.query.url;
    if (!url) return res.status(400).send('Missing url');
    
    // Serve from cache to ensure player 2 gets the exact same bytes instantly
    if (imageCache[url]) {
        res.setHeader('Content-Type', imageCache[url].contentType);
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cache-Control', 'public, max-age=31536000');
        return res.send(imageCache[url].buffer);
    }
    
    // Set a strict 10-second timeout for the AI generation so the frontend doesn't hang forever
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    
    try {
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        
        const contentType = response.headers.get('content-type') || 'image/svg+xml';
        imageCache[url] = { buffer, contentType }; // Cache it for the opponent
        setTimeout(() => { delete imageCache[url]; }, 5 * 60 * 1000); // Prevent memory leak
        
        res.setHeader('Content-Type', contentType);
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cache-Control', 'public, max-age=31536000');
        res.send(buffer);
    } catch (e) {
        clearTimeout(timeoutId);
        console.error('Image proxy error:', e.message);
        res.status(500).send('Proxy error');
    }
});

// Serve static files from the React frontend build
app.use(express.static(path.join(__dirname, '../client/dist')));

const customImages = {}; // custom images storage

app.post('/api/upload-image', (req, res) => {
    const { image } = req.body;
    if (!image) return res.status(400).send('No image provided');
    const id = Math.random().toString(36).substring(2, 10);
    customImages[id] = image; // Data URI format
    setTimeout(() => { delete customImages[id]; }, 2 * 60 * 60 * 1000); // Clean up after 2 hours
    res.json({ id });
});

app.get('/api/custom-image/:id', (req, res) => {
    const id = req.params.id;
    if (!customImages[id]) return res.status(404).send('Image not found');
    
    const match = customImages[id].match(/^data:(image\/\w+);base64,(.*)$/);
    if (!match) return res.status(400).send('Invalid image format');
    
    const contentType = match[1];
    const base64Data = match[2];
    const buffer = Buffer.from(base64Data, 'base64');
    
    res.setHeader('Content-Type', contentType);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(buffer);
});

app.get('/api/ping', (req, res) => {
    res.send('pong');
});

// Catch-all route to serve index.html for React Router (if used) and direct navigation
app.use((req, res) => {
  res.sendFile(path.join(__dirname, '../client/dist/index.html'));
});

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*", 
    methods: ["GET", "POST"]
  }
});

const rooms = {};

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  socket.on('joinRoom', ({ roomId, imageSrc, category }) => {
    socket.join(roomId);
    
    if (!rooms[roomId]) {
      rooms[roomId] = {
        players: [],
        gameStarted: false,
        referenceImage: imageSrc || `/reference_${Math.floor(Math.random() * 4) + 1}.png`,
        category: category || 'shapes',
        strokes: [], // Store all strokes for robust syncing
        scores: {},   // Store latest scores
        endTime: null,
        deleteTimeout: null
      };
    }

    if (rooms[roomId].deleteTimeout) {
        clearTimeout(rooms[roomId].deleteTimeout);
        rooms[roomId].deleteTimeout = null;
    }

    if (rooms[roomId].players.length < 2 && !rooms[roomId].players.includes(socket.id)) {
        rooms[roomId].players.push(socket.id);
    }
    
    console.log(`User ${socket.id} joined room ${roomId}`);
    
    // Send all existing state to the new user immediately
    socket.emit('initialState', { 
        strokes: rooms[roomId].strokes,
        scores: rooms[roomId].scores,
        referenceImage: rooms[roomId].referenceImage,
        gameStarted: rooms[roomId].gameStarted,
        endTime: rooms[roomId].endTime
    });

    // Notify room of player update
    io.to(roomId).emit('roomUpdate', { players: rooms[roomId].players });
    
    // Start game if 2 players are here, but wait 1s to let any "refresh ghost" disconnects clear out
    if (rooms[roomId].players.length === 2 && !rooms[roomId].gameStarted) {
        setTimeout(() => {
            if (rooms[roomId] && rooms[roomId].players.length === 2 && !rooms[roomId].gameStarted) {
                rooms[roomId].gameStarted = true;
                const endTime = Date.now() + 180000; // 3 minutes
                rooms[roomId].endTime = endTime;
                io.to(roomId).emit('gameStarted', { endTime });
                
                if (rooms[roomId].gameTimeout) clearTimeout(rooms[roomId].gameTimeout);
                
                rooms[roomId].gameTimeout = setTimeout(() => {
                    if (rooms[roomId]) {
                        io.to(roomId).emit('gameOver', { scores: rooms[roomId].scores });
                        rooms[roomId].gameStarted = false; // Prevent 'opponentLeft' forfeit logic after the game naturally ends
                    }
                }, 180000);
            }
        }, 1000);
    }
  });

  socket.on('drawData', ({ roomId, strokeData }) => {
    if (rooms[roomId]) {
        // Tag stroke with playerId so clients know who drew it
        const strokeWithId = { ...strokeData, playerId: socket.id };
        rooms[roomId].strokes.push(strokeWithId);
        // Broadcast to everyone else in the room
        socket.to(roomId).emit('drawData', { strokeData: strokeWithId });
    }
  });

  socket.on('undoStroke', ({ roomId }) => {
    if (rooms[roomId]) {
      const strokes = rooms[roomId].strokes;
      let lastStrokeId = null;
      for (let i = strokes.length - 1; i >= 0; i--) {
        if (strokes[i].playerId === socket.id) {
          lastStrokeId = strokes[i].strokeId;
          break;
        }
      }
      if (lastStrokeId) {
          rooms[roomId].strokes = strokes.filter(s => s.strokeId !== lastStrokeId);
      }
      socket.to(roomId).emit('undoStroke', { playerId: socket.id, strokeId: lastStrokeId });
    }
  });

  socket.on('clearCanvas', ({ roomId }) => {
    if (rooms[roomId]) {
      rooms[roomId].strokes = rooms[roomId].strokes.filter(s => s.playerId !== socket.id);
      rooms[roomId].scores[socket.id] = 0;
      socket.to(roomId).emit('clearCanvas', { playerId: socket.id });
    }
  });

  socket.on('scoreUpdate', ({ roomId, score }) => {
     if (rooms[roomId]) {
         rooms[roomId].scores[socket.id] = score;
         socket.to(roomId).emit('scoreUpdate', { score, playerId: socket.id });
     }
  });

  socket.on('checkRoom', (roomId, callback) => {
    if (!rooms[roomId]) {
        callback({ exists: false, error: "Room does not exist! Check the code and try again." });
    } else if (rooms[roomId].players.length >= 2) {
        callback({ exists: false, error: "Room is full! Maximum 2 players allowed." });
    } else {
        callback({ exists: true });
    }
  });

  socket.on('playAgain', ({ roomId }) => {
    if (rooms[roomId]) {
        // Only allow restart if game is actually over
        if (!rooms[roomId].gameStarted) {
            
            if (!rooms[roomId].rematchReady) rooms[roomId].rematchReady = [];
            if (!rooms[roomId].rematchReady.includes(socket.id)) {
                rooms[roomId].rematchReady.push(socket.id);
            }
            
            if (rooms[roomId].rematchReady.length === 2) {
                // Both players want to play again! Reset and start.
                rooms[roomId].rematchReady = [];
                rooms[roomId].strokes = [];
                rooms[roomId].scores = {};
                
                // Generate a new dynamic AI image for the rematch as an SVG for infinite vector resolution
                if (rooms[roomId].category === 'custom') {
                    // Retain the custom image for the rematch
                } else {
                    const randomSeed = Math.random().toString(36).substring(7);
                    const style = rooms[roomId].category || 'shapes';
                    const imageSrc = `https://api.dicebear.com/7.x/${style}/svg?seed=${randomSeed}&backgroundColor=0a0a0a,1a1a1a,e2e8f0,f8fafc,fef08a,fbcfe8,bfdbfe`;
                    rooms[roomId].referenceImage = `/api/proxy-image?url=${encodeURIComponent(imageSrc)}`;
                }
                
                // Start the game!
                rooms[roomId].gameStarted = true;
                const endTime = Date.now() + 180000; // 3 minutes
                rooms[roomId].endTime = endTime;
                
                io.to(roomId).emit('restartMatch', { 
                    referenceImage: rooms[roomId].referenceImage,
                    endTime
                });
                
                if (rooms[roomId].gameTimeout) clearTimeout(rooms[roomId].gameTimeout);
                
                rooms[roomId].gameTimeout = setTimeout(() => {
                    if (rooms[roomId]) {
                        io.to(roomId).emit('gameOver', { scores: rooms[roomId].scores });
                        rooms[roomId].gameStarted = false;
                    }
                }, 180000);
            } else {
                // Let the first player know they are waiting, and notify the second player
                socket.emit('waitingForRematch');
                socket.to(roomId).emit('opponentWantsRematch');
            }
        }
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    for (const roomId in rooms) {
      const room = rooms[roomId];
      const index = room.players.indexOf(socket.id);
      if (index !== -1) {
        room.players.splice(index, 1);
        io.to(roomId).emit('roomUpdate', { players: room.players });
        
        if (room.rematchReady) {
            room.rematchReady = room.rematchReady.filter(id => id !== socket.id);
        }

        if (room.players.length === 0) {
            // Give the creator a 10 second grace period to rejoin if they just refreshed the page
            room.deleteTimeout = setTimeout(() => {
                if (rooms[roomId] && rooms[roomId].players.length === 0) {
                    delete rooms[roomId]; 
                }
            }, 10000);
        } else {
            // If the game was already started, or they were on the post-game screen, notify the remaining player
            if (room.gameStarted || room.endTime !== null) {
                const forfeited = room.gameStarted;
                room.gameStarted = false; // Prevent new joiners from thinking the game is active
                io.to(roomId).emit('opponentLeft', { forfeited });
            }
        }
      }
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Socket.IO Server running on port ${PORT}`);
});
