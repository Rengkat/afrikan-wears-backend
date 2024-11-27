//load .env
require("dotenv").config();
//express
const express = require("express");
const connectDB = require("./db/connectDB");
const app = express();

// inbuilt modules

// rest of packages

// data base

// route importations
const authRoute = require("./routes/authRoute");

// middleware importations
const notFoundMiddleware = require("./middleware/not-found");
const errorHandlerMiddleware = require("./middleware/error-handler");

// middleware initialization

// home route for documentation

// route initialization
app.use("/api/auth");
// error initialization
app.use(notFoundMiddleware);
app.use(errorHandlerMiddleware);
// starting the app
const port = 5000;
const start = async () => {
  try {
    await connectDB(process.env.URI);
    app.listen(port, () => console.log(`Server running on port ${port}...`));
  } catch (error) {
    console.log(error.message);
    process.exit(1);
  }
};
start();
