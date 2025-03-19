const emitMessageEvent = (io, event, message) => {
  // Emit to the sender
  io.to(message.sender.toString()).emit(event, message);

  // Emit to the receiver
  io.to(message.receiver.toString()).emit(event, message);
};

module.exports = { emitMessageEvent };
