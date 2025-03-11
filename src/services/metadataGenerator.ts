import Anthropic from '@anthropic-ai/sdk';
import axios from 'axios';
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { PinataSDK } from 'pinata';
import Replicate from 'replicate';
import { MAX_TOKEN_NAME_LENGTH, MAX_TOKEN_SYMBOL_LENGTH } from '../config/constants.js';
import logger from '../utils/logger.js';

// Load environment variables
dotenv.config();

// Initialize API clients
const anthropic = new Anthropic({
  apiKey: process.env.CLAUDE_API_KEY,
});

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN || '',
});

const pinata = new PinataSDK({
  pinataJwt: process.env.PINATA_JWT || '',
  pinataGateway: process.env.PINATA_GATEWAY,
});

/**
 * Token metadata interface
 */
export interface TokenMetadata {
  name: string;
  symbol: string;
  image: string;
  showName: boolean;
  createdOn: string;
  twitter?: string;
  website?: string;
  telegram?: string;
}

/**
 * Generates token metadata using Claude API
 * @returns Generated token metadata
 */
export async function generateTokenMetadata(): Promise<{
  name: string;
  symbol: string;
  twitter?: string;
  website?: string;
  telegram?: string;
}> {
  logger.info('Generating token metadata with Claude API...');

  const prompt = `Generate a completely random and creative concept for a token or virtual item.

Each time this prompt is run, create something ENTIRELY DIFFERENT from previous runs. Be wildly creative and unpredictable.

Choose from these diverse categories (but don't limit yourself to them):
- Fictional creatures or characters
- Futuristic technology
- Fantasy items or artifacts
- Abstract concepts
- Artistic movements
- Imaginary foods
- Mythological entities
- Surreal landscapes
- Invented sports or games
- Fictional organizations

The name should be memorable, unique, and creative (max ${MAX_TOKEN_NAME_LENGTH} characters).
The symbol should be 2-${MAX_TOKEN_SYMBOL_LENGTH} characters, preferably 3-4 characters.

Also generate:
- Twitter/X profile URL (format: https://x.com/username)
- Website URL (format: https://www.example.com)
- Telegram group URL (format: https://t.me/groupname)

Format your response as a JSON object with the following fields:
- name: The item name (max ${MAX_TOKEN_NAME_LENGTH} characters)
- symbol: The item symbol (max ${MAX_TOKEN_SYMBOL_LENGTH} characters)
- twitter: Complete Twitter/X URL (https://x.com/username)
- website: Complete website URL (https://www.example.com)
- telegram: Complete Telegram group URL (https://t.me/groupname)

IMPORTANT: Each run should produce a completely different concept. Avoid repetitive themes or patterns.`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
    });

    // Extract JSON from response
    const content = response.content[0].type === 'text' ? response.content[0].text : '';
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```|({[\s\S]*})/);
    if (!jsonMatch) {
      throw new Error('Could not extract JSON from Claude response');
    }

    // Parse JSON content
    const jsonContent = jsonMatch[1] || jsonMatch[2];
    const metadata = JSON.parse(jsonContent);

    // Ensure URLs are complete
    if (metadata.twitter && !metadata.twitter.startsWith('http')) {
      metadata.twitter = `https://x.com/${metadata.twitter.replace('@', '')}`;
    }

    if (metadata.website && !metadata.website.startsWith('http')) {
      metadata.website = `https://${metadata.website}`;
    }

    if (metadata.telegram && !metadata.telegram.startsWith('http')) {
      metadata.telegram = `https://t.me/${metadata.telegram}`;
    }

    // Validate and trim metadata
    return {
      name: metadata.name.substring(0, MAX_TOKEN_NAME_LENGTH),
      symbol: metadata.symbol.substring(0, MAX_TOKEN_SYMBOL_LENGTH),
      twitter: metadata.twitter,
      website: metadata.website,
      telegram: metadata.telegram,
    };
  } catch (error) {
    logger.error('Error generating token metadata:', error);
    throw error;
  }
}

/**
 * Generates an image for the token using Replicate API
 * @param tokenName The name of the token
 * @param tokenSymbol The symbol of the token
 * @returns URL of the generated image
 */
export async function generateTokenImage(tokenName: string, tokenSymbol: string): Promise<string> {
  logger.info('Generating token image with Replicate API...');

  const prompt = `Create a visually striking and unique digital artwork representing "${tokenName}" (${tokenSymbol}). 
Make it highly distinctive and creative, with vibrant colors and interesting visual elements.
The image should be eye-catching and suitable as a token icon.
Avoid text, words, or letters in the image.
Create something that would look great as a profile picture or token.`;

  const maxRetries = 3;
  let retryCount = 0;

  while (retryCount < maxRetries) {
    try {
      const output = await replicate.run(
        'stability-ai/sdxl:39ed52f2a78e934b3ba6e2a89f5b1c712de7dfea535525255b1aa35c5565e08b',
        {
          input: {
            prompt,
            width: 512,
            height: 512,
            refine: 'expert_ensemble_refiner',
            scheduler: 'K_EULER',
            lora_scale: 0.6,
            num_outputs: 1,
            guidance_scale: 7.5,
            apply_watermark: false,
            high_noise_frac: 0.8,
            negative_prompt:
              'nsfw, offensive, explicit, sexual, text, words, letters, signature, watermark, cryptocurrency, crypto, coin, token, blockchain, low quality, blurry',
            prompt_strength: 0.8,
            num_inference_steps: 25,
          },
        },
      );

      if (Array.isArray(output) && output.length > 0) {
        return output[0] as string;
      } else {
        throw new Error('Failed to generate image with Replicate');
      }
    } catch (error) {
      retryCount++;
      logger.warning(
        `Image generation attempt ${retryCount} failed. ${
          maxRetries - retryCount
        } attempts remaining.`,
        error,
      );

      if (retryCount >= maxRetries) {
        logger.warning('All image generation attempts failed. Using default image URL.');
        return (
          'https://placehold.co/512x512/4287f5/ffffff?text=' + encodeURIComponent(`${tokenSymbol}`)
        );
      }

      // Wait before retrying
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  return 'https://placehold.co/512x512/4287f5/ffffff?text=' + encodeURIComponent(`${tokenSymbol}`);
}

/**
 * Uploads token metadata and image to IPFS using Pinata
 * @param metadata Token metadata
 * @param imageUrl URL of the token image
 * @returns IPFS URL of the metadata
 */
export async function uploadToIPFS(
  metadata: Omit<TokenMetadata, 'image'>,
  imageUrl: string,
): Promise<string> {
  logger.info('Uploading token metadata and image to IPFS using Pinata...');

  try {
    // Create temp directory if it doesn't exist
    const tempDir = path.join(process.cwd(), 'temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // Download the image from the URL
    const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
    const imageBuffer = Buffer.from(imageResponse.data);

    // Create a File object for the image
    const imageFile = new File([imageBuffer], `${metadata.symbol.toLowerCase()}.png`, {
      type: 'image/png',
    });

    // Upload the image to IPFS via Pinata
    const imageUploadResult = await pinata.upload.public.file(imageFile);
    const ipfsImageUrl = `ipfs://${imageUploadResult.cid}`;
    const httpsImageUrl = `https://ipfs.io/ipfs/${imageUploadResult.cid}`;
    logger.success(`Image uploaded to IPFS: ${ipfsImageUrl}`);

    // Create the complete metadata with the IPFS image URL
    const completeMetadata: TokenMetadata = {
      ...metadata,
      image: httpsImageUrl, // Use HTTPS URL instead of IPFS URL
      showName: true,
      createdOn: 'https://pump.fun',
    };

    // Upload the metadata to IPFS via Pinata
    const metadataUploadResult = await pinata.upload.public.json(completeMetadata);
    const ipfsMetadataUrl = `ipfs://${metadataUploadResult.cid}`;
    const httpsMetadataUrl = `https://ipfs.io/ipfs/${metadataUploadResult.cid}`;
    logger.success(`Metadata uploaded to IPFS: ${ipfsMetadataUrl}`);

    return httpsMetadataUrl; // Return HTTPS URL instead of IPFS URL
  } catch (error) {
    logger.error('Error uploading to IPFS:', error);
    throw error;
  }
}
