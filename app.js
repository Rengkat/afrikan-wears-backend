//load .env
require("dotenv").config();
const { Server } = require("socket.io");
const http = require("http");
//express and others
const express = require("express");
const app = express();
const server = http.createServer(app);

// rest of packages

// data base
const connectDB = require("./db/connectDB");

// route importations
const authRoute = require("./routes/authRoute");

// middleware importations
const notFoundMiddleware = require("./middleware/not-found");
const errorHandlerMiddleware = require("./middleware/error-handler");

// middleware initialization

// home route for documentation

// socket initialization
const io = new Server(server, {
  cors: {
    origin: "",
    credentials: true,
  },
});
// route initialization
app.use((req, res, next) => {
  req.io = io;
  next();
});
app.use("/api/auth", authRoute);
// error initialization
app.use(notFoundMiddleware);
app.use(errorHandlerMiddleware);
// starting the app
const port = 5000;
const start = async () => {
  try {
    await connectDB(process.env.MONGO_URI);
    server.listen(port, () => console.log(`Server running on port ${port}...`));
  } catch (error) {
    console.log(error.message);
    process.exit(1);
  }
};
start();
