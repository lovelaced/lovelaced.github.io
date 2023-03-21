const terminal = document.getElementById('terminal');
const message = "Data travelers, electro wizards, techno anarchists. Anything's possible. Expect the unexpected, chaos, whatever...";
let charIndex = 0;

function printMessage() {
  if (charIndex < message.length) {
    terminal.textContent += message.charAt(charIndex);
    charIndex++;
    setTimeout(printMessage, 50);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  // Add the following line right after the DOMContentLoaded event listener
  printMessage();
});

