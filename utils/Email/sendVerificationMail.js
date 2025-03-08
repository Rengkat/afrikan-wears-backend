const sendEmail = require("./sendMail");

const sendVerificationEmail = async ({ email, origin, name, verificationToken }) => {
  const link = `${origin}/auth/verify-email?verificationToken=${verificationToken}&email=${email}`;
  const html = ``;
  sendEmail({ to: email, html, subject: "Email Verification" });
};
module.exports = sendVerificationEmail;
