const nodemailer = require("nodemailer");
const nodemailerConfig = require("./EmailConfig");

const sendEmail = async ({ to, html, subject }) => {
  const transporter = nodemailer.createTransport(nodemailerConfig);
  await transporter.sendMail({
    to,
    from: ` AfrikanWears <${process.env.GMAIL_ADDRESS}>`,
    html,
    subject,
  });
};
module.exports = sendEmail;
