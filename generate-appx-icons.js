const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

// Configuration
const sourceIcon = path.join(__dirname, 'assets', '1024x1024.png');
const outputDir = path.join(__dirname, 'assets', 'appx');

// Ensure output directory exists
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Standard AppX assets
const sizes = [
  { name: 'Square44x44Logo.png', width: 44, height: 44 },
  { name: 'Square150x150Logo.png', width: 150, height: 150 },
  { name: 'StoreLogo.png', width: 50, height: 50 },
];

// Targetsize variants for Square44x44Logo (used for taskbar, file explorer, etc.)
// These are CRITICAL for proper icon display - without them Windows uses default Electron icon
const targetSizes = [16, 24, 32, 48, 256];

async function generate() {
  console.log(`Generating AppX icons from ${sourceIcon}...`);

  // 1. Generate standard square icons
  for (const size of sizes) {
    await sharp(sourceIcon)
      .resize(size.width, size.height)
      .toFile(path.join(outputDir, size.name));
    console.log(`Generated ${size.name}`);
  }

  // 2. Generate Wide310x150Logo.png (Icon centered on transparent canvas)
  // We resize the icon to 150px height to fit, then composite it onto the wide canvas
  await sharp({
    create: {
      width: 310,
      height: 150,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 } // Transparent
    }
  })
    .composite([
      {
        input: await sharp(sourceIcon).resize(150, 150, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer(),
        gravity: 'center'
      }
    ])
    .toFile(path.join(outputDir, 'Wide310x150Logo.png'));

  console.log('Generated Wide310x150Logo.png');

  // 3. Generate targetsize variants for Square44x44Logo (CRITICAL for taskbar icon)
  // These replace the default Electron icon in taskbar, file explorer, etc.
  for (const size of targetSizes) {
    const filename = `Square44x44Logo.targetsize-${size}.png`;
    await sharp(sourceIcon)
      .resize(size, size)
      .toFile(path.join(outputDir, filename));
    console.log(`Generated ${filename}`);
  }

  console.log('✅ Done! AppX icons are in assets/appx/');
}

generate().catch(err => console.error(err));

