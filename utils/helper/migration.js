require("dotenv").config();
const mongoose = require("mongoose");
const Token = require("../models/tokenModel");

const migrate = async () => {
  await mongoose.connect(process.env.MONGO_URL);
  console.log("Connected to DB");

  const users = await Token.distinct("user");
  console.log(`Found ${users.length} users with tokens`);

  let totalDeleted = 0;

  for (const userId of users) {
    // Delete invalid tokens first
    const invalidDelete = await Token.deleteMany({
      user: userId,
      isValid: false,
    });

    totalDeleted += invalidDelete.deletedCount;

    const tokens = await Token.find({
      user: userId,
      isValid: true,
    }).sort({ lastUsed: -1, createdAt: -1 });

    if (tokens.length <= 1) continue;

    const toDelete = tokens.slice(1).map((t) => t._id);

    const result = await Token.deleteMany({
      _id: { $in: toDelete },
    });

    totalDeleted += result.deletedCount;

    console.log(`User ${userId}: kept 1 valid token, deleted ${result.deletedCount}`);
  }

  console.log(`\nMigration complete. Total tokens deleted: ${totalDeleted}`);

  await mongoose.disconnect();
};

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
