import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Parse command line arguments
// Usage: node index.js [--hijab <folder>] [--provider <openai|gemini>]
function parseArgs() {
  const args = process.argv.slice(2);
  const result = {
    hijabFolder: null,
    provider: 'gemini', // default to gemini
    amazon: false,
    color: null,
    caption: false
  };
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--hijab' && args[i + 1]) {
      result.hijabFolder = args[i + 1];
      i++;
    } else if (args[i] === '--provider' && args[i + 1]) {
      result.provider = args[i + 1];
      i++;
    } else if (args[i] === '--amazon') {
      result.amazon = true;
    } else if (args[i] === '--color' && args[i + 1]) {
      result.color = args[i + 1];
      i++;
    } else if (args[i] === '--caption') {
      result.caption = true;
    } else if (!args[i].startsWith('--')) {
      // First non-flag argument is hijab folder (shorthand)
      result.hijabFolder = args[i];
    }
  }
  
  // Fall back to environment variables if not set via CLI
  if (!result.hijabFolder && process.env.HIJAB_FOLDER) {
    result.hijabFolder = process.env.HIJAB_FOLDER;
  }
  if (process.env.IMAGE_PROVIDER && !process.argv.includes('--provider')) {
    result.provider = process.env.IMAGE_PROVIDER;
  }
  
  return result;
}

const CLI_ARGS = parseArgs();
const IMAGE_PROVIDER = CLI_ARGS.provider;
const HIJAB_FOLDER = CLI_ARGS.hijabFolder;
const AMAZON_MODE = CLI_ARGS.amazon;
const HIJAB_COLOR = CLI_ARGS.color;
const GENERATE_CAPTION = CLI_ARGS.caption;

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Initialize Google Gemini client
const gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const STYLE_INPUT_DIR = path.join(__dirname, 'style_input');
const HIJAB_INPUT_DIR = path.join(__dirname, 'hijab_input');
const OUTPUT_DIR = path.join(__dirname, 'output_folder');

/**
 * Get all image files from a directory
 */
async function getImageFiles(dir) {
  const files = await fs.readdir(dir);
  const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic', '.heif'];
  return files.filter(file => 
    imageExtensions.some(ext => file.toLowerCase().endsWith(ext))
  );
}

/**
 * Get random items from an array
 */
function getRandomItems(array, count) {
  const shuffled = [...array].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, count);
}

/**
 * Get hijab images from hijab_input subdirectories
 * If HIJAB_FOLDER is set, only use that specific folder
 * Otherwise, randomly pick one folder
 */
async function getHijabImages() {
  const hijabImages = [];
  
  if (!(await fs.pathExists(HIJAB_INPUT_DIR))) {
    console.warn('Warning: ' + HIJAB_INPUT_DIR + ' does not exist. Creating it...');
    await fs.ensureDir(HIJAB_INPUT_DIR);
    return hijabImages;
  }
  
  let subdirs = await fs.readdir(HIJAB_INPUT_DIR);
  
  // Filter out hidden files/folders
  subdirs = subdirs.filter(s => !s.startsWith('.'));
  
  // Get only directories
  const validDirs = [];
  for (const subdir of subdirs) {
    const subdirPath = path.join(HIJAB_INPUT_DIR, subdir);
    const stat = await fs.stat(subdirPath);
    if (stat.isDirectory()) {
      validDirs.push(subdir);
    }
  }
  
  if (validDirs.length === 0) {
    console.warn('No hijab folders found in ' + HIJAB_INPUT_DIR);
    return hijabImages;
  }
  
  let selectedFolder;
  
  // Filter to specific folder if HIJAB_FOLDER is set
  if (HIJAB_FOLDER) {
    if (validDirs.includes(HIJAB_FOLDER)) {
      selectedFolder = HIJAB_FOLDER;
      console.log('Using specific hijab folder: ' + selectedFolder);
    } else {
      console.error('Error: Hijab folder "' + HIJAB_FOLDER + '" not found. Available folders:', validDirs);
      return hijabImages;
    }
  } else {
    // Randomly pick one folder
    selectedFolder = validDirs[Math.floor(Math.random() * validDirs.length)];
    console.log('Randomly selected hijab folder: ' + selectedFolder);
  }
  
  const selectedPath = path.join(HIJAB_INPUT_DIR, selectedFolder);
  const images = await getImageFiles(selectedPath);
  for (const image of images) {
    hijabImages.push({
      name: selectedFolder,
      path: path.join(selectedPath, image),
    });
  }
  
  return hijabImages;
}

/**
 * Get mime type from file extension
 */
function getMimeType(filePath) {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const mimeTypes = {
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'webp': 'image/webp',
    'heic': 'image/heic',
    'heif': 'image/heif'
  };
  return mimeTypes[ext] || 'image/png';
}

/**
 * Build prompt based on mode (color vs hijab image, amazon vs default)
 */
function buildPrompt(styleImageCount) {
  let defaultPrompt, amazonPrompt;
  
  if (HIJAB_COLOR) {
    // Color-based prompts
    defaultPrompt = 'Use the ' + styleImageCount + ' images as style references (lighting, colors, composition, mood, aesthetic). Create a Instagram portrait matching the style from the reference images, with the model wearing a hijab in ' + HIJAB_COLOR + ' color. Only the hijab should be ' + HIJAB_COLOR + '; keep the rest of the outfit neutral and not ' + HIJAB_COLOR + '. Remove hijab wrinkles.';
    amazonPrompt = 'Use the ' + styleImageCount + ' images as style references (lighting, colors, composition, mood, aesthetic). Create a Instagram portrait matching the style from the reference images, with the model wearing only a hijab in ' + HIJAB_COLOR + ' color. Only the hijab should be ' + HIJAB_COLOR + '; keep the rest of the outfit neutral and not ' + HIJAB_COLOR + '. Remove hijab wrinkles. Model must not be sitting. Background must be completely white. Hijab must fit within frame';
  } else {
    // Hijab image-based prompts
    defaultPrompt = 'Use the first ' + styleImageCount + ' images as style references (lighting, colors, composition, mood, aesthetic). The last image shows a hijab. Create a Instagram portrait matching the style from the reference images, with the model wearing the hijab from the last image. Only the hijab should match the hijab image; keep the rest of the outfit neutral and not matching the hijab pattern or color. Remove hijab wrinkles.';
    amazonPrompt = 'Use the first ' + styleImageCount + ' images as style references (lighting, colors, composition, mood, aesthetic). The last image shows a hijab. Create a Instagram portrait matching the style from the reference images, with the model wearing only the hijab from the last image. Only the hijab should match the hijab image; keep the rest of the outfit neutral and not matching the hijab pattern or color. Remove hijab wrinkles. Model must not be sitting. Background must be completely white. Hijab must fit within frame';
  }
  
  return AMAZON_MODE ? amazonPrompt : defaultPrompt;
}

/**
 * Generate image using OpenAI gpt-image-1 Images Edit API
 * Uses all style images plus the hijab image (or color if specified)
 */
async function generateImageOpenAI(styleImages, hijabImage) {
  const hijabName = hijabImage ? hijabImage.name : HIJAB_COLOR;
  
  console.log('Generating image with OpenAI gpt-image-1: ' + hijabName + '...');
  console.log('Using ' + styleImages.length + ' style images as reference');
  
  const prompt = buildPrompt(styleImages.length);
  if (AMAZON_MODE) {
    console.log('Using Amazon product photo mode');
  }
  if (HIJAB_COLOR) {
    console.log('Using hijab color: ' + HIJAB_COLOR);
  }
  
  try {
    // Create file objects for all style images
    const imageFiles = [];
    
    for (const stylePath of styleImages) {
      const buffer = await fs.readFile(stylePath);
      const fileName = path.basename(stylePath);
      const file = await OpenAI.toFile(buffer, fileName, {
        type: getMimeType(stylePath)
      });
      imageFiles.push(file);
    }
    
    // Add hijab image last (only if not using color mode)
    if (!HIJAB_COLOR && hijabImage) {
      const hijabImageBuffer = await fs.readFile(hijabImage.path);
      const hijabFileName = path.basename(hijabImage.path);
      const hijabFile = await OpenAI.toFile(hijabImageBuffer, hijabFileName, {
        type: getMimeType(hijabImage.path)
      });
      imageFiles.push(hijabFile);
    }
    
    const response = await openai.images.edit({
      model: 'gpt-image-1',
      prompt: prompt,
      image: imageFiles
    });
    
    if (response.data && response.data.length > 0) {
      const imageData = response.data[0].b64_json;
      if (imageData) {
        return imageData;
      } else {
        throw new Error('No image data returned from OpenAI');
      }
    } else {
      throw new Error('No image data returned from OpenAI');
    }
  } catch (error) {
    console.error('Error generating image for ' + hijabName + ':', error.message);
    throw error;
  }
}

/**
 * Generate image using Google Gemini
 * Uses all style images plus the hijab image (or color if specified)
 */
async function generateImageGemini(styleImages, hijabImage) {
  const hijabName = hijabImage ? hijabImage.name : HIJAB_COLOR;
  
  console.log('Generating image with Gemini gemini-3-pro-image-preview: ' + hijabName + '...');
  console.log('Using ' + styleImages.length + ' style images as reference');
  
  if (AMAZON_MODE) {
    console.log('Using Amazon product photo mode');
  }
  if (HIJAB_COLOR) {
    console.log('Using hijab color: ' + HIJAB_COLOR);
  }
  
  try {
    // Build parts array with all style images
    const parts = [];
    
    // Add prompt first
    const prompt = buildPrompt(styleImages.length);
    parts.push({ text: prompt });
    
    // Add all style images
    for (const stylePath of styleImages) {
      const buffer = await fs.readFile(stylePath);
      const base64 = buffer.toString('base64');
      const mimeType = getMimeType(stylePath);
      parts.push({
        inlineData: {
          mimeType: mimeType,
          data: base64
        }
      });
    }
    
    // Add hijab image last (only if not using color mode)
    if (!HIJAB_COLOR && hijabImage) {
      const hijabImageBuffer = await fs.readFile(hijabImage.path);
      const hijabImageBase64 = hijabImageBuffer.toString('base64');
      const hijabMimeType = getMimeType(hijabImage.path);
      parts.push({
        inlineData: {
          mimeType: hijabMimeType,
          data: hijabImageBase64
        }
      });
    }
    
    const response = await gemini.models.generateContent({
      model: 'gemini-3-pro-image-preview',
      contents: [
        {
          role: 'user',
          parts: parts
        }
      ],
      generationConfig: {
        responseModalities: ['image', 'text']
      }
    });
    
    // Extract image from response
    if (response.candidates && response.candidates.length > 0) {
      const candidate = response.candidates[0];
      if (candidate.content && candidate.content.parts) {
        for (const part of candidate.content.parts) {
          if (part.inlineData && part.inlineData.data) {
            return part.inlineData.data; // Return base64 image data
          }
        }
      }
    }
    
    throw new Error('No image data returned from Gemini');
  } catch (error) {
    console.error('Error generating image for ' + hijabName + ':', error.message);
    throw error;
  }
}

/**
 * Generate image using selected provider
 */
async function generateImage(styleImages, hijabImage) {
  if (IMAGE_PROVIDER === 'gemini') {
    return generateImageGemini(styleImages, hijabImage);
  } else {
    return generateImageOpenAI(styleImages, hijabImage);
  }
}

/**
 * Generate Instagram caption for an image using Gemini
 */
async function generateCaption(imagePath, hijabName) {
  const displayName = hijabName.replace(/_/g, ' ');
  console.log('Generating Instagram caption for ' + displayName + '...');
  
  try {
    const imageBuffer = await fs.readFile(imagePath);
    const imageBase64 = imageBuffer.toString('base64');
    const mimeType = getMimeType(imagePath);
    
    const response = await gemini.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: 'Create an engaging Instagram caption for this hijab fashion photo. The hijab style is called "' + displayName + '". Include relevant hashtags. Keep it elegant, inspiring, and suitable for a fashion/lifestyle account. Output ONLY the caption text, nothing else.'
            },
            {
              inlineData: {
                mimeType: mimeType,
                data: imageBase64
              }
            }
          ]
        }
      ]
    });
    
    if (response.candidates && response.candidates.length > 0) {
      const candidate = response.candidates[0];
      if (candidate.content && candidate.content.parts) {
        for (const part of candidate.content.parts) {
          if (part.text) {
            return part.text.trim();
          }
        }
      }
    }
    
    return 'Beautiful hijab style. #hijabfashion #modestfashion';
  } catch (error) {
    console.error('Error generating caption:', error.message);
    return 'Elegant ' + displayName + ' hijab fashion. #hijabstyle #modestfashion #' + hijabName.replace(/_/g, '');
  }
}

/**
 * Load existing gallery data
 */
async function loadGalleryData() {
  const galleryPath = path.join(OUTPUT_DIR, 'gallery.json');
  try {
    if (await fs.pathExists(galleryPath)) {
      const data = await fs.readFile(galleryPath, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.log('No existing gallery data found, starting fresh');
  }
  return { images: [] };
}

/**
 * Save gallery data
 */
async function saveGalleryData(galleryData) {
  const galleryPath = path.join(OUTPUT_DIR, 'gallery.json');
  await fs.writeFile(galleryPath, JSON.stringify(galleryData, null, 2));
  console.log('Gallery data saved to ' + galleryPath);
}

/**
 * Detect image format from buffer magic bytes
 */
function detectImageFormat(buffer) {
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
    return 'jpg';
  }
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
    return 'png';
  }
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
    return 'gif';
  }
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) {
    return 'webp';
  }
  return 'png'; // default
}

/**
 * Save image (from URL or base64 data) to output folder
 * Returns the actual file extension used
 */
async function saveImage(imageData, outputPath) {
  try {
    let buffer;
    
    if (imageData.startsWith('data:') || !imageData.startsWith('http')) {
      // Base64 data
      const base64Data = imageData.includes(',') ? imageData.split(',')[1] : imageData;
      buffer = Buffer.from(base64Data, 'base64');
    } else {
      // URL - download it
      const response = await fetch(imageData);
      if (!response.ok) {
        throw new Error('Failed to download image: ' + response.statusText);
      }
      const arrayBuffer = await response.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
    }
    
    // Detect actual format and fix extension if needed
    const actualFormat = detectImageFormat(buffer);
    const currentExt = path.extname(outputPath).toLowerCase().replace('.', '');
    
    let finalPath = outputPath;
    if (actualFormat !== currentExt && actualFormat !== 'png') {
      // Replace extension with the actual format
      finalPath = outputPath.replace(/\.[^.]+$/, '.' + actualFormat);
      console.log('Detected ' + actualFormat.toUpperCase() + ' format, saving as: ' + path.basename(finalPath));
    }
    
    await fs.writeFile(finalPath, buffer);
    console.log('Saved image to: ' + finalPath);
    
    return path.basename(finalPath); // Return the actual filename
  } catch (error) {
    console.error('Error saving image to ' + outputPath + ':', error.message);
    throw error;
  }
}

/**
 * Main function to process images
 */
async function main() {
  // Show help if requested
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(`
Usage: node index.js [options] [hijab_folder]

Options:
  --hijab <folder>     Specify hijab folder (e.g., Tanjiro_Anime_Print)
  --color <color>     Specify hijab color instead of folder (e.g., "black", "lime green")
  --provider <name>   Image provider: gemini (default) or openai
  --amazon            Use Amazon product photo style (white background, standing model)
  --caption           Generate Instagram caption for the image (default: no caption)
  --help, -h          Show this help message

Examples:
  node index.js Tanjiro_Anime_Print
  node index.js --hijab mint_green --provider gemini
  node index.js --provider gemini              # Random hijab folder
  node index.js --color "lime green"           # Generate with lime green hijab
  node index.js --color black --amazon         # Black hijab, Amazon style
    `);
    process.exit(0);
  }
  
  try {
    // Ensure directories exist
    await fs.ensureDir(STYLE_INPUT_DIR);
    await fs.ensureDir(HIJAB_INPUT_DIR);
    await fs.ensureDir(OUTPUT_DIR);
    
    // Check for API keys based on provider
    if (IMAGE_PROVIDER === 'gemini') {
      if (!process.env.GEMINI_API_KEY) {
        throw new Error('GEMINI_API_KEY is not set in environment variables');
      }
      console.log('Starting image generation process...');
      console.log('Using Google Gemini gemini-3-pro-image-preview model');
    } else {
      if (!process.env.OPENAI_API_KEY) {
        throw new Error('OPENAI_API_KEY is not set in environment variables');
      }
      console.log('Starting image generation process...');
      console.log('Using OpenAI gpt-image-1 model');
    }
    
    // Get style images
    const styleImageFiles = await getImageFiles(STYLE_INPUT_DIR);
    
    if (styleImageFiles.length === 0) {
      throw new Error('No image files found in ' + STYLE_INPUT_DIR);
    }
    
    if (styleImageFiles.length < 3) {
      console.warn('Warning: Only ' + styleImageFiles.length + ' style images found. Using all available images.');
    }
    
    // Select 3 random style images
    const selectedStyleImages = getRandomItems(styleImageFiles, Math.min(3, styleImageFiles.length));
    const styleImagePaths = selectedStyleImages.map(img => path.join(STYLE_INPUT_DIR, img));
    
    console.log('Selected ' + selectedStyleImages.length + ' style images:', selectedStyleImages);
    
    // Handle color mode vs hijab folder mode
    if (HIJAB_COLOR) {
      // Color mode: generate single image with specified color
      console.log('Using hijab color mode: ' + HIJAB_COLOR);
      
      try {
        const imageData = await generateImage(styleImagePaths, null);
        
        // Create output filename
        const timestamp = Date.now();
        const colorName = HIJAB_COLOR.replace(/\s+/g, '_').toLowerCase();
        const tempFilename = colorName + '_' + timestamp + '.png';
        const tempPath = path.join(OUTPUT_DIR, tempFilename);
        
        // Save the image (returns actual filename with correct extension)
        const actualFilename = await saveImage(imageData, tempPath);
        const actualPath = path.join(OUTPUT_DIR, actualFilename);
        
        // Generate caption only if --caption flag is passed
        let caption = '';
        if (GENERATE_CAPTION) {
          caption = await generateCaption(actualPath, HIJAB_COLOR);
          console.log('Caption: ' + caption.substring(0, 100) + '...');
        }
        
        // Reload gallery from disk (in case other processes added images) then append
        const freshGallery = await loadGalleryData();
        freshGallery.images.push({
          id: timestamp,
          filename: actualFilename,
          hijabStyle: HIJAB_COLOR,
          caption: caption,
          createdAt: new Date().toISOString(),
          provider: IMAGE_PROVIDER
        });
        await saveGalleryData(freshGallery);
      } catch (error) {
        console.error('Failed to generate image with color ' + HIJAB_COLOR + ':', error.message);
        throw error;
      }
    } else {
      // Hijab folder mode: get hijab images from folders
      const hijabImages = await getHijabImages();
      
      if (hijabImages.length === 0) {
        throw new Error('No hijab images found in ' + HIJAB_INPUT_DIR + ' subdirectories');
      }
      
      console.log('Found ' + hijabImages.length + ' hijab images');
      
      // Generate images for each hijab style
      for (const hijabImage of hijabImages) {
        try {
          const imageData = await generateImage(styleImagePaths, hijabImage);
          
          // Create output filename
          const timestamp = Date.now();
          const tempFilename = hijabImage.name + '_' + timestamp + '.png';
          const tempPath = path.join(OUTPUT_DIR, tempFilename);
          
          // Save the image (returns actual filename with correct extension)
          const actualFilename = await saveImage(imageData, tempPath);
          const actualPath = path.join(OUTPUT_DIR, actualFilename);
          
          // Generate caption only if --caption flag is passed
          let caption = '';
          if (GENERATE_CAPTION) {
            caption = await generateCaption(actualPath, hijabImage.name);
            console.log('Caption: ' + caption.substring(0, 100) + '...');
          }
          
          // Reload gallery from disk (in case other processes added images) then append
          const freshGallery = await loadGalleryData();
          freshGallery.images.push({
            id: timestamp,
            filename: actualFilename,
            hijabStyle: hijabImage.name,
            caption: caption,
            createdAt: new Date().toISOString(),
            provider: IMAGE_PROVIDER
          });
          await saveGalleryData(freshGallery);
          
          // Add a small delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
          console.error('Failed to process hijab image ' + hijabImage.name + ':', error.message);
          // Continue with next image
        }
      }
    }
    
    console.log('Image generation process completed!');
  } catch (error) {
    console.error('Error in main process:', error.message);
    process.exit(1);
  }
}

// Run the main function
main();
