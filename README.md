# Instagram Photo Style Creator

A Node.js service that uses AI to create Instagram-style photos by combining style inspiration from input photos with hijab clothing from specified directories.

## Features

- Randomly selects 3 photos from `style_input` folder as style inspiration
- Uses GPT-4o Vision to analyze both style and hijab images together
- Uses Stability AI image-to-image API to generate images combining the style with hijab clothing
- Outputs generated images to `output_folder`

## Prerequisites

- Node.js (v18 or higher)
- OpenAI API key ([Get one here](https://platform.openai.com/api-keys)) - for GPT-4o Vision analysis
- Stability AI API key ([Get one here](https://platform.stability.ai/)) - for image generation

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create a `.env` file in the root directory:
```bash
cp .env.example .env
```

3. Add your API keys to `.env`:
```
OPENAI_API_KEY=your_openai_api_key_here
STABILITY_API_KEY=your_stability_api_key_here
```

4. Create the required directories:
```bash
mkdir -p style_input hijab_input output_folder
```

5. Add your style inspiration photos to `style_input/` folder

6. Add hijab images to `hijab_input/` subdirectories:
   - `hijab_input/hijab_name_1/` - place hijab images here
   - `hijab_input/hijab_name_2/` - place hijab images here
   - etc.

## Usage

Run the service:
```bash
npm start
```

Or run in watch mode for development:
```bash
npm run dev
```

## Directory Structure

```
instagram-photo-style-creator/
├── style_input/          # Place style inspiration photos here
├── hijab_input/          # Hijab image directories
│   ├── hijab_name_1/     # Hijab style 1 images
│   ├── hijab_name_2/     # Hijab style 2 images
│   └── ...
├── output_folder/        # Generated images will be saved here
├── index.js              # Main service file
├── package.json
└── .env                  # Your API keys (not committed)
```

## How It Works

1. The service randomly selects 3 photos from `style_input` folder
2. For each hijab style in `hijab_input` subdirectories, it:
   - Uses GPT-4o Vision to analyze both the style images AND the hijab image together
   - Creates a detailed prompt describing how to combine the style with the hijab
   - Uses Stability AI's image-to-image API with the first style image as base
   - Applies the hijab style from the prompt to create a new image
   - Saves the generated image to `output_folder` with a timestamp

## Supported Image Formats

- Input: `.jpg`, `.jpeg`, `.png`, `.webp`, `.gif`
- Output: `.png` (1024x1024)

## Notes

- The service uses GPT-4o Vision (OpenAI) to analyze images and create prompts
- Image generation is done via Stability AI's image-to-image API
- Both APIs have rate limits and costs per request
- The service uses the first style image as the base for image-to-image generation

## License

MIT
