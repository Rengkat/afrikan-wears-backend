// Load .env
require("dotenv").config();
const { Server } = require("socket.io");
const http = require("http");

// Express and middleware
const cors = require("cors");
const express = require("express");
const cookieParser = require("cookie-parser");
const expressFileUpload = require("express-fileupload");
const morgan = require("morgan");

const app = express();
const server = http.createServer(app);

// Database connection
const connectDB = require("./db/connectDB");

// Route imports
const authRoute = require("./routes/authRoute");
const productRoute = require("./routes/productRoute");
const userRoute = require("./routes/userRouter");
// Middleware imports
const notFoundMiddleware = require("./middleware/not-found");
const errorHandlerMiddleware = require("./middleware/error-handler");

// Middleware setup
app.use(express.json());
app.use(cookieParser());
app.use(expressFileUpload({ useTempFiles: true }));
app.use(express.static("public"));

// Home route for documentation
app.get("/", (req, res) => {
  res.send("Welcome to the API");
});

// CORS setup
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(",") || ["http://localhost:3000"];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  })
);

// Socket.io initialization
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    credentials: true,
  },
});

// Attach socket instance to request object
app.use((req, res, next) => {
  req.io = io;
  next();
});

// Routes
app.use("/api/auth", authRoute);
app.use("/api/products", productRoute);
app.use("/api/users", userRoute);

// Error handling middleware
app.use(notFoundMiddleware);
app.use(errorHandlerMiddleware);

// Start the server
const port = process.env.PORT || 5000;
const start = async () => {
  try {
    await connectDB(process.env.MONGO_URI);
    server.listen(port, () => console.log(`Server running on port ${port}...`));
  } catch (error) {
    console.error("Database connection failed:", error.message);
    process.exit(1);
  }
};

start();
