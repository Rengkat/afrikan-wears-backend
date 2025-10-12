const fundWalletEmail = async ({ email, origin, name, payload: transaction }) => {
  try {
    // Format order items for the email
    const transaction = order.orderItems
      .map(
        (item) => `
        <tr>
          <td>${item.name}</td>
          <td>${item.quantity}</td>
          <td>₦${item.priceAtPurchase.toLocaleString()}</td>
          <td>₦${(item.quantity * item.priceAtPurchase).toLocaleString()}</td>
        </tr>
      `
      )
      .join("");

    const html = `
        <h2>Hello ${name},</h2>
        <p>Thank you for your order! Here are the details:</p>
        
        <h3>Order Summary</h3>
        <table border="1" cellpadding="5" cellspacing="0" style="border-collapse: collapse; width: 100%;">
          <thead>
            <tr>
              <th>Product</th>
              <th>Quantity</th>
              <th>Unit Price</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            ${orderItemsHtml}
          </tbody>
          <tfoot>
            <tr>
              <td colspan="3" style="text-align: right;"><strong>Subtotal:</strong></td>
              <td>₦${order.totalPrice.toLocaleString()}</td>
            </tr>
            <tr>
              <td colspan="3" style="text-align: right;"><strong>Order Total:</strong></td>
              <td>₦${order.totalPrice.toLocaleString()}</td>
            </tr>
          </tfoot>
        </table>
        
        <h3>Order Information</h3>
        <p><strong>Order Number:</strong> ${order.orderNumber}</p>
        <p><strong>Date:</strong> ${new Date(order.createdAt).toLocaleString()}</p>
        <p><strong>Status:</strong> ${order.orderStatus}</p>
        
        <p>You can view your order details in your account dashboard.</p>
        <p>If you have any questions about your order, please contact our support team.</p>
        
        <p>Thank you for shopping with us!</p>
      `;

    await sendEmail({
      to: email,
      html,
      subject: `Your Order #${order.orderNumber} has been received`,
    });

    console.log("Order confirmation email sent successfully.");
  } catch (error) {
    console.error("Error sending order confirmation email:", error);
    // Consider logging the error to a monitoring service
  }
};
