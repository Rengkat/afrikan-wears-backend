const sendEmail = require("./sendMail");

const sendResetPasswordEmail = async ({ email, origin, verificationToken, name }) => {
  const link = `${origin}/auth/reset-password?verificationToken=${verificationToken}&email=${email}`;
  const html = `<h2>Hello ${name}</h2>
  <p>You have requested to reset your password for your AfrikanWears account. Click the link below to proceed:</p>
  <a href="${link}">Reset Password</a>
  <p>If you did not request this, please ignore this email.</p>
  <p>This link will expire in 1 hour for security reasons.</p>
  `;

  try {
    await sendEmail({ to: email, html, subject: "Reset Password" });
    console.log("Reset password email sent successfully.");
  } catch (error) {
    console.error("Error sending reset password email:", error);
  }
};

module.exports = sendResetPasswordEmail;
