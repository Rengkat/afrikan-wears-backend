const express = require("express");
const {
  createOrder,
  getMyOrders,
  getAllOrders,
  completeCustomOrderPayment,
  verifyPayment,
  getSingleOrder,
  getStylistOrders,
  updateOrderStatus,
  updateOrderItemStatus,
} = require("../controllers/orderController");
const {
  authenticateUser,
  adminAuthorization,
  adminAndStylistAuthorization,
  authorize,
} = require("../middleware/authentication");

const router = express.Router();
// Customer routes
router
  .route("/")
  .post(authenticateUser, authorize("user"), createOrder)
  .get(authenticateUser, adminAuthorization, getAllOrders);
router.get("/my-orders", authenticateUser, getMyOrders);

router.get(
  "/stylist/orders",
  authenticateUser,
  adminAndStylistAuthorization("stylist"),
  getStylistOrders
);
router.post("/:orderId/complete-payment", authenticateUser, completeCustomOrderPayment);
router.post("/:orderId/verify-payment", authenticateUser, verifyPayment);
router.get("/:id", authenticateUser, getSingleOrder);

router.patch(
  "/:id/status",
  authenticateUser,
  adminAndStylistAuthorization("admin", "stylist"),
  updateOrderStatus
);

router.patch(
  "/:id/items/:itemId/status",
  authenticateUser,
  adminAndStylistAuthorization("admin", "stylist"),
  updateOrderItemStatus
);

module.exports = router;
