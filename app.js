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

// middleware importations

// middleware initialization

// home route for documentation

// route initialization

// error initialization

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
