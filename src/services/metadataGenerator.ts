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

// Validate Pinata configuration
if (!process.env.PINATA_JWT) {
  logger.error('PINATA_JWT environment variable is not configured');
}

if (!process.env.PINATA_GATEWAY) {
  logger.error('PINATA_GATEWAY environment variable is not configured');
}

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

  const prompt = `Generate a completely random and HILARIOUS concept for a meme token or absurd virtual item.

Each time this prompt is run, create something ENTIRELY DIFFERENT that would make people laugh or say "WTF?!" Be wildly creative, ridiculous, and unpredictable.

Choose from these absurd categories (but don't limit yourself to them):
- Food items with human personalities
- Household objects with superpowers
- Animals doing inappropriate human activities
- Bodily functions turned into superheroes
- Inanimate objects with existential crises
- Cursed hybrid creatures (like "half-toaster, half-dolphin")
- Everyday items but EXTREMELY specific versions
- Ridiculous conspiracy theories as entities
- Things that shouldn't be sentient but are
- Absurd services no one asked for
- Nonsensical sports with impossible rules
- Fictional foods that would taste terrible
- Bizarre phobias that don't exist
- Appliances with emotional problems
- Memes that went too far
- Interdimensional bathroom products
- Sentient body parts with their own agendas
- Cursed emojis come to life
- Extremely specific dating apps
- Cosmic horrors but they're adorable

The name should be MEMORABLE, FUNNY, and possibly make people uncomfortable (max ${MAX_TOKEN_NAME_LENGTH} characters).
The symbol should be 2-${MAX_TOKEN_SYMBOL_LENGTH} characters, preferably something that makes you chuckle.

Also generate:
- Twitter/X profile URL (format: https://x.com/username)
- Website URL (format: https://www.example.com or https://example.com)
- Telegram group URL (format: https://t.me/groupname)

Format your response as a JSON object with the following fields:
- name: The ridiculous item name (max ${MAX_TOKEN_NAME_LENGTH} characters)
- symbol: The funny symbol (max ${MAX_TOKEN_SYMBOL_LENGTH} characters)
- twitter: Complete Twitter/X URL (https://x.com/username)
- website: Complete website URL (https://www.example.com or https://example.com)
- telegram: Complete Telegram group URL (https://t.me/groupname)

IMPORTANT: Each run should produce a completely different concept. Make it FUNNY, ABSURD, or WTF-worthy!`;

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

    // Randomly decide which social media URLs to include
    const includeSocials = {
      twitter: Math.random() > 0.5,
      website: Math.random() > 0.5,
      telegram: Math.random() > 0.5,
    };

    // Randomly format website URL (with or without www)
    if (includeSocials.website && metadata.website) {
      // If website already has www, randomly remove it
      if (metadata.website.includes('www.') && Math.random() > 0.5) {
        metadata.website = metadata.website.replace('www.', '');
      }
      // If website doesn't have www, randomly add it
      else if (!metadata.website.includes('www.') && Math.random() > 0.5) {
        const urlParts = metadata.website.split('//');
        if (urlParts.length > 1) {
          metadata.website = `${urlParts[0]}//${urlParts[1].startsWith('www.') ? '' : 'www.'}${
            urlParts[1]
          }`;
        }
      }
    }

    // Validate and trim metadata
    return {
      name: metadata.name.substring(0, MAX_TOKEN_NAME_LENGTH),
      symbol: metadata.symbol.substring(0, MAX_TOKEN_SYMBOL_LENGTH),
      twitter: includeSocials.twitter ? metadata.twitter : undefined,
      website: includeSocials.website ? metadata.website : undefined,
      telegram: includeSocials.telegram ? metadata.telegram : undefined,
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

  const prompt = `Create a HILARIOUS and ABSURD digital artwork representing "${tokenName}" (${tokenSymbol}). 
Make it ridiculous, funny, and possibly a bit disturbing - something that would make people say "WTF?!"
Use vibrant colors, weird visual elements, and unexpected combinations.
The image should be eye-catching and memorable - think internet meme quality but original.
Avoid text, words, or letters in the image.
Create something that would make people laugh or be confused in the best possible way.`;

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
    const httpsImageUrl = `https://${process.env.PINATA_GATEWAY}/ipfs/${imageUploadResult.cid}`;
    logger.success(`Image uploaded to IPFS: ${ipfsImageUrl}`);

    // Create the complete metadata with the IPFS image URL
    const completeMetadata: TokenMetadata = {
      ...metadata,
      image: httpsImageUrl,
      showName: true,
      createdOn: 'https://pump.fun',
    };

    // Upload the metadata to IPFS via Pinata
    const metadataUploadResult = await pinata.upload.public.json(completeMetadata);
    const ipfsMetadataUrl = `ipfs://${metadataUploadResult.cid}`;
    const httpsMetadataUrl = `https://${process.env.PINATA_GATEWAY}/ipfs/${metadataUploadResult.cid}`;
    logger.success(`Metadata uploaded to IPFS: ${ipfsMetadataUrl}`);

    return httpsMetadataUrl;
  } catch (error) {
    logger.error('Error uploading to IPFS:', error);
    throw error;
  }
}
