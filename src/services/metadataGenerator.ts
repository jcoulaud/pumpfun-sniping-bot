import axios from 'axios';
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import OpenAI from 'openai';
import { PinataSDK } from 'pinata';
import Replicate from 'replicate';
import { TokenMetadata } from '../types/index.js';
import logger from '../utils/logger.js';

// Load environment variables
dotenv.config();

// Initialize API clients
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
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

// Token constraints
const MAX_TOKEN_NAME_LENGTH = 32;
const MAX_TOKEN_SYMBOL_LENGTH = 10;

/**
 * Generates token metadata using OpenAI API
 */
export async function generateTokenMetadata(): Promise<TokenMetadata> {
  logger.info('Generating token metadata with OpenAI...');

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
DO NOT use emojis, smileys, or special unicode characters in the name or symbol.
The symbol should be 2-${MAX_TOKEN_SYMBOL_LENGTH} characters using only letters and numbers, preferably something that makes you chuckle.

Also generate:
- Twitter/X profile URL (format: https://x.com/username)
- Website URL (format: https://www.example.com or https://example.com)
- Telegram group URL (format: https://t.me/groupname)

Format your response as a JSON object with the following fields:
- name: The ridiculous item name (max ${MAX_TOKEN_NAME_LENGTH} characters) - NO EMOJIS
- symbol: The funny symbol (max ${MAX_TOKEN_SYMBOL_LENGTH} characters) - LETTERS/NUMBERS ONLY
- description: A brief funny description of what this token represents
- twitter: Complete Twitter/X URL (https://x.com/username)
- website: Complete website URL (https://www.example.com or https://example.com)
- telegram: Complete Telegram group URL (https://t.me/groupname)

IMPORTANT: Each run should produce a completely different concept. Make it FUNNY, ABSURD, or WTF-worthy!`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 500,
      temperature: 1.2, // High creativity
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No content received from OpenAI');
    }

    // Extract JSON from response
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```|({[\s\S]*})/);
    let jsonContent = jsonMatch ? jsonMatch[1] || jsonMatch[2] : content;

    // Clean up the JSON content
    jsonContent = jsonContent.trim();
    if (!jsonContent.startsWith('{')) {
      // Try to find JSON in the content
      const startIndex = jsonContent.indexOf('{');
      const endIndex = jsonContent.lastIndexOf('}');
      if (startIndex !== -1 && endIndex !== -1) {
        jsonContent = jsonContent.substring(startIndex, endIndex + 1);
      }
    }

    const metadata = JSON.parse(jsonContent);

    // Validate and trim metadata
    return {
      name: metadata.name.substring(0, MAX_TOKEN_NAME_LENGTH),
      symbol: metadata.symbol.substring(0, MAX_TOKEN_SYMBOL_LENGTH),
      description: metadata.description || `A hilarious ${metadata.name} token`,
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
 */
export async function generateTokenImage(tokenName: string, tokenSymbol: string): Promise<string> {
  logger.info('Generating token image with Replicate...');

  const prompt = `Professional digital artwork representing "${tokenName}".
Create a high-quality, detailed, and visually striking image that embodies the concept of ${tokenName}.
Style: vibrant, detailed, photorealistic quality with creative artistic flair.
Make it eye-catching and memorable with rich colors and sharp details.
The image should look polished and professional, not obviously AI-generated.
Focus on excellent composition, lighting, and visual impact.
Avoid any text, words, letters, or watermarks in the image.`;

  const maxRetries = 3;
  let retryCount = 0;

  while (retryCount < maxRetries) {
    try {
      const output = await replicate.run('black-forest-labs/flux-1.1-pro', {
        input: {
          prompt,
          width: 512,
          height: 512,
          output_format: 'png',
          output_quality: 95,
          safety_tolerance: 2,
          prompt_upsampling: true,
        },
      });

      if (Array.isArray(output) && output.length > 0) {
        return output[0] as string;
      } else if (typeof output === 'string') {
        return output;
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
        logger.warning('All image generation attempts failed. Using placeholder image.');
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
 */
export async function uploadToIPFS(
  metadata: Omit<TokenMetadata, 'image'>,
  imageUrl: string,
): Promise<string> {
  logger.info('Uploading to IPFS via Pinata...');

  try {
    // Create temp directory if it doesn't exist
    const tempDir = path.join(process.cwd(), 'temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // Download the image
    const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
    const imageBuffer = Buffer.from(imageResponse.data);

    // Create a File object for the image
    const imageFile = new File([imageBuffer], `${metadata.symbol.toLowerCase()}.png`, {
      type: 'image/png',
    });

    // Upload the image to IPFS
    const imageUploadResult = await pinata.upload.public.file(imageFile);
    const httpsImageUrl = `https://${process.env.PINATA_GATEWAY}/ipfs/${imageUploadResult.cid}`;
    logger.success(`Image uploaded to IPFS: ${imageUploadResult.cid}`);

    // Create the complete metadata with the IPFS image URL
    const completeMetadata: TokenMetadata = {
      ...metadata,
      image: httpsImageUrl,
      showName: true,
      createdOn: 'https://pump.fun',
    };

    // Upload the metadata to IPFS
    const metadataUploadResult = await pinata.upload.public.json(completeMetadata);
    const httpsMetadataUrl = `https://${process.env.PINATA_GATEWAY}/ipfs/${metadataUploadResult.cid}`;
    logger.success(`Metadata uploaded to IPFS: ${metadataUploadResult.cid}`);

    return httpsMetadataUrl;
  } catch (error) {
    logger.error('Error uploading to IPFS:', error);
    throw error;
  }
}
