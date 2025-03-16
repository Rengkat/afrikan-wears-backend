const sendEmail = require("./sendMail");

const sendVerificationEmail = async ({ email, origin, name, verificationToken }) => {
  const link = `${origin}/auth/verify-email?verificationToken=${verificationToken}&email=${email}`;
  const html = `<h2>Hello ${name}</h2>
  <p>Thanks for signing up with AfrikanWears. Kindly verify your email by clicking on the link below:</p>
  <a href="${link}">Verify email</a>
  <p>If you did not initiate this, please ignore this email.</p>
  `;

  try {
    await sendEmail({ to: email, html, subject: "Email Verification" });
    console.log("Verification email sent successfully.");
  } catch (error) {
    console.error("Error sending verification email:", error);
  }
};

module.exports = sendVerificationEmail;
