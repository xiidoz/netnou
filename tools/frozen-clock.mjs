// Holds the clock of a server still at the moment FAKE_NOW names, a time as
// Date.parse reads it: Date.now() answers it, whatever time it is. Given to
// the server with node --import by build-pictures.mjs, so that the pictures
// show the same moment whenever they are taken. Its worker threads take it
// over with the other options of the command line.

const at = Date.parse(process.env.FAKE_NOW);
if (Number.isNaN(at)) throw new Error(`FAKE_NOW is not a time: ${process.env.FAKE_NOW}`);
Date.now = () => at;
