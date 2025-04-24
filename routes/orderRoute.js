const express = require("express");
const { createOrder, getMyOrders } = require("../controllers/orderController");
const { authenticateUser } = require("../middleware/authentication");

const router = express.Router();
// Customer routes
router.route("/").post(authenticateUser, createOrder);

router.post("/verify-payment/:orderId", authenticateUser, getMyOrders);
// router.get("/me", authenticateUser, getMyOrders);

// router.get("/:id", authenticateUser, orderController.getSingleOrder);

// // Stylist routes
// router.get(
//   "/stylist/orders",
//   authenticateUser,
//   authorizeRoles("stylist"),
//   cacheMiddleware("stylist:orders"),
//   orderController.getStylistOrders
// );

// router.patch(
//   "/:id/status",
//   authenticateUser,
//   authorizeRoles("stylist"),
//   clearCache(["user:*:orders*", "stylist:*:orders*"]),
//   orderController.updateOrderStatus
// );

// router.patch(
//   "/:id/items/:itemId/status",
//   authenticateUser,
//   authorizeRoles("stylist"),
//   clearCache(["user:*:orders*", "stylist:*:orders*"]),
//   orderController.updateOrderItemStatus
// );

module.exports = router;
