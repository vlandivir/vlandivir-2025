import { PrismaClient } from '../generated/prisma-client';
import { LlmService } from '../services/llm.service';
import { StorageService } from '../services/storage.service';
import { ConfigService } from '@nestjs/config';

interface UpdateResult {
    success: boolean;
    imageId: number;
    error?: string;
    description?: string;
}

// Parse command line arguments
function parseArgs() {
    const args = process.argv.slice(2);
    const limitIndex = args.indexOf('--limit');
    const limit = limitIndex !== -1 && args[limitIndex + 1] 
        ? parseInt(args[limitIndex + 1], 10) 
        : null;
    
    return { limit };
}

async function updateImageDescriptions() {
    const { limit } = parseArgs();
    const prisma = new PrismaClient();
    const configService = new ConfigService();
    const storageService = new StorageService(configService);
    const llmService = new LlmService(configService);

    try {
        console.log('Starting image description update...');
        if (limit) {
            console.log(`📋 Processing only the last ${limit} images without descriptions`);
        }

        // Check if OpenAI API key is configured
        const apiKey = configService.get<string>('OPENAI_API_KEY');
        if (!apiKey) {
            console.error('❌ OPENAI_API_KEY is not configured. Please set it in your environment variables.');
            return;
        }

        // Get images without descriptions, ordered by creation date (newest first)
        const imagesQuery: any = {
            where: {
                OR: [
                    { description: null },
                    { description: '' }
                ]
            },
            include: {
                note: true
            },
            orderBy: {
                createdAt: 'desc' // Get newest first
            }
        };

        // Apply limit if specified
        if (limit) {
            imagesQuery['take'] = limit;
        }

        const imagesWithoutDescriptions = await prisma.image.findMany(imagesQuery);

        console.log(`Found ${imagesWithoutDescriptions.length} images without descriptions`);

        if (imagesWithoutDescriptions.length === 0) {
            console.log('✅ No images need description updates');
            return;
        }

        // Process images in batches to avoid rate limits
        const batchSize = 5; // Reduced batch size for better rate limit handling
        let processed = 0;
        let successCount = 0;
        let errorCount = 0;
        const results: UpdateResult[] = [];

        for (let i = 0; i < imagesWithoutDescriptions.length; i += batchSize) {
            const batch = imagesWithoutDescriptions.slice(i, i + batchSize);
            const batchNumber = Math.floor(i / batchSize) + 1;
            const totalBatches = Math.ceil(imagesWithoutDescriptions.length / batchSize);
            
            console.log(`\n📦 Processing batch ${batchNumber}/${totalBatches} (${batch.length} images)`);

            // Process batch with individual error handling
            const batchPromises = batch.map(async (image) => {
                try {
                    console.log(`  🔄 Processing image ${image.id} (${image.url})`);

                    // Download image from storage
                    const imageBuffer = await storageService.downloadFile(image.url);
                    
                    // Get description from LLM
                    const description = await llmService.describeImage(imageBuffer);

                    // Skip if description is the error message
                    if (description === 'Не удалось описать изображение') {
                        throw new Error('LLM service returned error message');
                    }

                    // Update database
                    await prisma.image.update({
                        where: { id: image.id },
                        data: { description }
                    });

                    console.log(`  ✅ Updated image ${image.id}:\n  ${description}\n`);
                    return { 
                        success: true, 
                        imageId: image.id, 
                        description 
                    };
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                    console.error(`  ❌ Error processing image ${image.id}: ${errorMessage}`);
                    return { 
                        success: false, 
                        imageId: image.id, 
                        error: errorMessage 
                    };
                }
            });

            const batchResults = await Promise.all(batchPromises);
            results.push(...batchResults);
            
            // Count results
            batchResults.forEach(result => {
                if (result.success) {
                    successCount++;
                } else {
                    errorCount++;
                }
            });

            processed += batch.length;
            const progressPercent = Math.round(processed / imagesWithoutDescriptions.length * 100);
            console.log(`  📊 Progress: ${processed}/${imagesWithoutDescriptions.length} (${progressPercent}%)`);
            console.log(`  📈 Success: ${successCount}, Errors: ${errorCount}`);

            // Add delay between batches to avoid rate limits
            if (i + batchSize < imagesWithoutDescriptions.length) {
                console.log('  ⏳ Waiting 3 seconds before next batch...');
                await new Promise(resolve => setTimeout(resolve, 3000));
            }
        }

        // Final summary
        console.log('\n' + '='.repeat(50));
        console.log('🎉 UPDATE COMPLETE');
        console.log('='.repeat(50));
        console.log(`📊 Total images processed: ${processed}`);
        console.log(`✅ Successful updates: ${successCount}`);
        console.log(`❌ Failed updates: ${errorCount}`);
        console.log(`📈 Success rate: ${Math.round(successCount / processed * 100)}%`);

        // Show failed images for manual review
        const failedImages = results.filter(r => !r.success);
        if (failedImages.length > 0) {
            console.log('\n❌ Failed images (for manual review):');
            failedImages.forEach(failed => {
                console.log(`  - Image ID: ${failed.imageId}, Error: ${failed.error}`);
            });
        }
    } catch (error) {
        console.error('💥 Script error:', error);
    } finally {
        await prisma.$disconnect();
    }
}

// Run the script
if (require.main === module) {
    updateImageDescriptions()
        .then(() => {
            console.log('\n🎯 Script completed');
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n💥 Script failed:', error);
            process.exit(1);
        });
} 