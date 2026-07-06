const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

app.get('/api/proxy-image', async (req, res) => {
    const url = req.query.url;
    if (!url) return res.status(400).send('Missing url');
    
    // Set a strict 10-second timeout for the AI generation so the frontend doesn't hang forever
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    
    try {
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        
        res.setHeader('Content-Type', response.headers.get('content-type') || 'image/jpeg');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cache-Control', 'public, max-age=31536000');
        res.send(buffer);
    } catch (e) {
        clearTimeout(timeoutId);
        console.error('Image proxy error:', e.message);
        res.status(500).send('Proxy error');
    }
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

  socket.on('joinRoom', ({ roomId, imageSrc }) => {
    socket.join(roomId);
    
    if (!rooms[roomId]) {
      rooms[roomId] = {
        players: [],
        gameStarted: false,
        referenceImage: imageSrc || `/reference_${Math.floor(Math.random() * 4) + 1}.png`,
        strokes: [], // Store all strokes for robust syncing
        scores: {}   // Store latest scores
      };
    }

    if (rooms[roomId].players.length < 2 && !rooms[roomId].players.includes(socket.id)) {
        rooms[roomId].players.push(socket.id);
    }
    
    console.log(`User ${socket.id} joined room ${roomId}`);
    
    // Send all existing state to the new user immediately
    socket.emit('initialState', { 
        strokes: rooms[roomId].strokes,
        scores: rooms[roomId].scores,
        referenceImage: rooms[roomId].referenceImage
    });

    // Notify room of player update
    io.to(roomId).emit('roomUpdate', { players: rooms[roomId].players });
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

  socket.on('scoreUpdate', ({ roomId, score }) => {
     if (rooms[roomId]) {
         rooms[roomId].scores[socket.id] = score;
         socket.to(roomId).emit('scoreUpdate', { score, playerId: socket.id });
     }
  });

  socket.on('checkRoom', (roomId, callback) => {
    // Return true if the room exists
    callback(!!rooms[roomId]);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    for (const roomId in rooms) {
      const room = rooms[roomId];
      const index = room.players.indexOf(socket.id);
      if (index !== -1) {
        room.players.splice(index, 1);
        io.to(roomId).emit('roomUpdate', { players: room.players });
        if (room.players.length === 0) {
            delete rooms[roomId]; 
        }
      }
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Socket.IO Server running on port ${PORT}`);
});
