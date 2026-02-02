import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get provider from environment or default to 'openai'
// Options: 'openai' or 'gemini'
const IMAGE_PROVIDER = process.env.IMAGE_PROVIDER || 'openai';

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
 */
async function getHijabImages() {
  const hijabImages = [];
  
  if (!(await fs.pathExists(HIJAB_INPUT_DIR))) {
    console.warn('Warning: ' + HIJAB_INPUT_DIR + ' does not exist. Creating it...');
    await fs.ensureDir(HIJAB_INPUT_DIR);
    return hijabImages;
  }
  
  const subdirs = await fs.readdir(HIJAB_INPUT_DIR);
  
  for (const subdir of subdirs) {
    const subdirPath = path.join(HIJAB_INPUT_DIR, subdir);
    const stat = await fs.stat(subdirPath);
    
    if (stat.isDirectory()) {
      const images = await getImageFiles(subdirPath);
      for (const image of images) {
        hijabImages.push({
          name: subdir,
          path: path.join(subdirPath, image),
        });
      }
    }
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
 * Generate image using OpenAI gpt-image-1 Images Edit API
 * Uses all style images plus the hijab image
 */
async function generateImageOpenAI(styleImages, hijabImage) {
  const hijabName = hijabImage.name;
  
  console.log('Generating image with OpenAI gpt-image-1: ' + hijabName + '...');
  console.log('Using ' + styleImages.length + ' style images as reference');
  
  const prompt = 'Use the first ' + styleImages.length + ' images as style references (lighting, colors, composition, mood, aesthetic). The last image shows a hijab. Create a professional Instagram portrait matching the style from the reference images, with the model wearing the hijab from the last image.';
  
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
    
    // Add hijab image last
    const hijabImageBuffer = await fs.readFile(hijabImage.path);
    const hijabFileName = path.basename(hijabImage.path);
    const hijabFile = await OpenAI.toFile(hijabImageBuffer, hijabFileName, {
      type: getMimeType(hijabImage.path)
    });
    imageFiles.push(hijabFile);
    
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
 * Uses all style images plus the hijab image
 */
async function generateImageGemini(styleImages, hijabImage) {
  const hijabName = hijabImage.name;
  
  console.log('Generating image with Gemini gemini-3-pro-image-preview: ' + hijabName + '...');
  console.log('Using ' + styleImages.length + ' style images as reference');
  
  try {
    // Build parts array with all style images
    const parts = [];
    
    // Add prompt first
    const prompt = 'Use the first ' + styleImages.length + ' images as style references (lighting, colors, composition, mood, aesthetic). The last image shows a hijab. Create a professional Instagram portrait matching the style from the reference images, with the model wearing the hijab from the last image.';
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
    
    // Add hijab image last
    const hijabImageBuffer = await fs.readFile(hijabImage.path);
    const hijabImageBase64 = hijabImageBuffer.toString('base64');
    const hijabMimeType = getMimeType(hijabImage.path);
    parts.push({
      inlineData: {
        mimeType: hijabMimeType,
        data: hijabImageBase64
      }
    });
    
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
    
    // Get hijab images
    const hijabImages = await getHijabImages();
    
    if (hijabImages.length === 0) {
      throw new Error('No hijab images found in ' + HIJAB_INPUT_DIR + ' subdirectories');
    }
    
    console.log('Found ' + hijabImages.length + ' hijab images');
    
    // Load existing gallery data
    const galleryData = await loadGalleryData();
    
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
        
        // Generate caption for the image
        const caption = await generateCaption(actualPath, hijabImage.name);
        console.log('Caption: ' + caption.substring(0, 100) + '...');
        
        // Add to gallery data
        galleryData.images.push({
          id: timestamp,
          filename: actualFilename,
          hijabStyle: hijabImage.name,
          caption: caption,
          createdAt: new Date().toISOString(),
          provider: IMAGE_PROVIDER
        });
        
        // Save gallery data after each image
        await saveGalleryData(galleryData);
        
        // Add a small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        console.error('Failed to process hijab image ' + hijabImage.name + ':', error.message);
        // Continue with next image
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
