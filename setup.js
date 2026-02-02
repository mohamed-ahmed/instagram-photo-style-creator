import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STYLE_INPUT_DIR = path.join(__dirname, 'style_input');
const HIJAB_INPUT_DIR = path.join(__dirname, 'hijab_input');
const OUTPUT_DIR = path.join(__dirname, 'output_folder');

async function setup() {
  try {
    console.log('Setting up directories...');
    
    await fs.ensureDir(STYLE_INPUT_DIR);
    console.log(`✓ Created ${STYLE_INPUT_DIR}`);
    
    await fs.ensureDir(HIJAB_INPUT_DIR);
    console.log(`✓ Created ${HIJAB_INPUT_DIR}`);
    
    await fs.ensureDir(OUTPUT_DIR);
    console.log(`✓ Created ${OUTPUT_DIR}`);
    
    // Create example hijab directories
    const exampleHijabDirs = [
      path.join(HIJAB_INPUT_DIR, 'hijab_name_1'),
      path.join(HIJAB_INPUT_DIR, 'hijab_name_2'),
    ];
    
    for (const dir of exampleHijabDirs) {
      await fs.ensureDir(dir);
      console.log(`✓ Created ${dir}`);
    }
    
    console.log('\nSetup complete!');
    console.log('\nNext steps:');
    console.log('1. Add style inspiration photos to:', STYLE_INPUT_DIR);
    console.log('2. Add hijab images to subdirectories in:', HIJAB_INPUT_DIR);
    console.log('3. Create a .env file with your OPENAI_API_KEY');
    console.log('4. Run: npm start');
  } catch (error) {
    console.error('Error setting up directories:', error.message);
    process.exit(1);
  }
}

setup();
