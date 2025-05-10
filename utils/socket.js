const emitNotificationEvent = (io, event, notification) => {
  // Emit to specific user(s) based on notification type
  switch (notification.type) {
    case "message":
      // For messages (existing functionality)
      io.to(notification.receiver.toString()).emit(event, notification);
      io.to(notification.sender.toString()).emit(event, notification);
      break;

    case "product-approval":
      // For product approval notifications (to admin)
      io.to("admin").emit(event, notification);
      break;

    case "product-approved":
      // For product approved notifications (to stylist)
      io.to(notification.stylistId.toString()).emit(event, notification);
      break;

    case "new-order":
      // For new order notifications (to admin and stylist)
      io.to("admin").emit(event, notification);
      notification.stylists.forEach((stylistId) => {
        io.to(stylistId.toString()).emit(event, notification);
      });
      break;

    case "order-status":
      // For order status updates (to customer)
      io.to(notification.customerId.toString()).emit(event, notification);
      break;

    default:
      console.warn(`Unknown notification type: ${notification.type}`);
  }
};

module.exports = {
  emitMessageEvent: emitNotificationEvent, // Keep backward compatibility
  emitNotificationEvent,
};
