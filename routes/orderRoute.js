const express = require("express");
const router = express.Router();
const { cacheMiddleware, clearCache } = require("../middleware/cacheMiddleware");
const orderController = require("../controllers/orderController");
const { authenticateUser, authorizeRoles } = require("../middleware/authMiddleware");

// Customer routes
router.post(
  "/",
  authenticateUser,
  clearCache(["user:*:orders*", "stylist:*:orders*"]),
  orderController.createOrder
);

router.get("/me", authenticateUser, cacheMiddleware("user:orders"), orderController.getMyOrders);

router.get("/:id", authenticateUser, orderController.getSingleOrder);

// Stylist routes
router.get(
  "/stylist/orders",
  authenticateUser,
  authorizeRoles("stylist"),
  cacheMiddleware("stylist:orders"),
  orderController.getStylistOrders
);

router.patch(
  "/:id/status",
  authenticateUser,
  authorizeRoles("stylist"),
  clearCache(["user:*:orders*", "stylist:*:orders*"]),
  orderController.updateOrderStatus
);

router.patch(
  "/:id/items/:itemId/status",
  authenticateUser,
  authorizeRoles("stylist"),
  clearCache(["user:*:orders*", "stylist:*:orders*"]),
  orderController.updateOrderItemStatus
);

module.exports = router;
