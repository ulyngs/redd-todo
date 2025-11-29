const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

// Configuration
const sourceIcon = path.join(__dirname, 'assets', '1024x1024.png');
const outputDir = path.join(__dirname, 'assets', 'store');

// App brand color (white)
const brandColor = '#ffffff';

// Ensure output directory exists
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

async function generate() {
  console.log(`Generating Store Listing assets from ${sourceIcon}...`);

  // 1. Transparent Icons (Store Display Images)
  // These replace the package icons in store listings
  const iconSizes = [
    { name: 'Store_Icon_300x300.png', size: 300 },
    { name: 'Store_Icon_150x150.png', size: 150 },
    { name: 'Store_Icon_71x71.png', size: 71 },
  ];

  for (const icon of iconSizes) {
    await sharp(sourceIcon)
      .resize(icon.size, icon.size)
      .toFile(path.join(outputDir, icon.name));
    console.log(`Generated ${icon.name}`);
  }

  // 2. Box Art (1:1) - 1080x1080
  // Solid background with centered logo
  // Logo size approx 85% of canvas = 918px
  const boxArtSize = 1080;
  const boxArtLogoSize = 918;
  
  await sharp({
    create: {
      width: boxArtSize,
      height: boxArtSize,
      channels: 4,
      background: brandColor
    }
  })
  .composite([
    {
      input: await sharp(sourceIcon).resize(boxArtLogoSize, boxArtLogoSize).toBuffer(),
      gravity: 'center'
    }
  ])
  .toFile(path.join(outputDir, 'Store_BoxArt_1080x1080.png'));
  console.log('Generated Store_BoxArt_1080x1080.png');

  // 3. Poster Art (9:16) - 720x1080
  // Solid background with centered logo
  // Logo size approx 85% of width = 612px
  const posterWidth = 720;
  const posterHeight = 1080;
  const posterLogoSize = 612;

  await sharp({
    create: {
      width: posterWidth,
      height: posterHeight,
      channels: 4,
      background: brandColor
    }
  })
  .composite([
    {
      input: await sharp(sourceIcon).resize(posterLogoSize, posterLogoSize).toBuffer(),
      gravity: 'center'
    }
  ])
  .toFile(path.join(outputDir, 'Store_Poster_720x1080.png'));
  console.log('Generated Store_Poster_720x1080.png');

  // 4. Super Hero Art (16:9) - 1920x1080
  // Solid background with centered logo
  // Logo size approx 40% of width = 768px
  const heroWidth = 1920;
  const heroHeight = 1080;
  const heroLogoSize = 768;

  await sharp({
    create: {
      width: heroWidth,
      height: heroHeight,
      channels: 4,
      background: brandColor
    }
  })
  .composite([
    {
      input: await sharp(sourceIcon).resize(heroLogoSize, heroLogoSize).toBuffer(),
      gravity: 'center'
    }
  ])
  .toFile(path.join(outputDir, 'Store_Hero_1920x1080.png'));
  console.log('Generated Store_Hero_1920x1080.png');

  console.log('✅ Done! Store assets are in assets/store/');
}

generate().catch(err => console.error(err));

