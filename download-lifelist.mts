#!/usr/bin/env node

/**
 * Script to download eBird life list by logging in and fetching the CSV
 * Usage: node --experimental-strip-types download-lifelist.mts <username> <password>
 */

async function downloadLifeList(username: string, password: string) {
    try {
        // Step 1: Get the login page to extract execution token
        console.log('Fetching login page...');
        const loginUrl = 'https://secure.birds.cornell.edu/cassso/login?service=https%3A%2F%2Febird.org%2Flogin%2Fcas%3Fportal%3Debird&locale=en';
        console.log('URL:', loginUrl);
        
        const loginPageResponse = await fetch(loginUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:150.0) Gecko/20100101 Firefox/150.0',
            }
        }).catch((err) => {
            console.error('Fetch failed with error:');
            console.error('  Error name:', err.name);
            console.error('  Error message:', err.message);
            console.error('  Error code:', err.code);
            console.error('  Error cause:', err.cause);
            console.error('  Full error:', err);
            throw err;
        });
        
        console.log('Login page response status:', loginPageResponse.status, loginPageResponse.statusText);
        console.log('Login page response headers:', Object.fromEntries(loginPageResponse.headers.entries()));
        
        if (!loginPageResponse.ok) {
            throw new Error(`Failed to fetch login page: ${loginPageResponse.status} ${loginPageResponse.statusText}`);
        }
        
        const loginPageHtml = await loginPageResponse.text();
        console.log('Login page HTML length:', loginPageHtml.length);
        console.log('Login page HTML preview:', loginPageHtml.substring(0, 200));
        
        // Extract execution token from the login page
        const executionMatch = loginPageHtml.match(/name="execution"\s+value="([^"]+)"/);
        if (!executionMatch) {
            throw new Error('Could not find execution token in login page');
        }
        const execution = executionMatch[1];
        console.log('Found execution token');

        // Step 2: Submit login form
        console.log('\nLogging in...');
        console.log('Username:', username);
        console.log('Execution token:', execution);
        
        const loginResponse = await fetch('https://secure.birds.cornell.edu/cassso/login', {
            method: 'POST',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:150.0) Gecko/20100101 Firefox/150.0',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Content-Type': 'application/x-www-form-urlencoded',
                'Referer': 'https://secure.birds.cornell.edu/cassso/login?service=https%3A%2F%2Febird.org%2Flogin%2Fcas%3Fportal%3Debird&locale=en',
            },
            body: new URLSearchParams({
                service: 'https://ebird.org/login/cas?portal=ebird',
                locale: 'en',
                username: username,
                password: password,
                rememberMe: 'on',
                execution: execution,
                _eventId: 'submit'
            }).toString(),
            redirect: 'manual' // Don't follow redirects automatically
        });

        // Collect cookies from the login response
        const cookies: string[] = [];
        const setCookieHeaders = loginResponse.headers.getSetCookie?.() || [];
        for (const cookie of setCookieHeaders) {
            const cookiePart = cookie.split(';')[0];
            cookies.push(cookiePart);
        }

        console.log('Login response status:', loginResponse.status);
        console.log('Collected cookies:', cookies.length);
        if (cookies.length > 0) {
            console.log('Cookie names:', cookies.map(c => c.split('=')[0]).join(', '));
        } else {
            console.warn('⚠️  No cookies collected from login response!');
        }

        // Step 3: Follow redirect to complete login flow
        const locationHeader = loginResponse.headers.get('location');
        if (locationHeader) {
            console.log('\nFollowing redirect...');
            console.log('Redirect URL:', locationHeader);
            const redirectResponse = await fetch(locationHeader, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:150.0) Gecko/20100101 Firefox/150.0',
                    'Cookie': cookies.join('; ')
                },
                redirect: 'manual'
            });

            // Collect more cookies from redirect
            const redirectSetCookies = redirectResponse.headers.getSetCookie?.() || [];
            for (const cookie of redirectSetCookies) {
                const cookiePart = cookie.split(';')[0];
                cookies.push(cookiePart);
            }

            console.log('Redirect status:', redirectResponse.status);
            console.log('Total cookies:', cookies.length);
            console.log('All cookie names:', cookies.map(c => c.split('=')[0]).join(', '));
        } else {
            console.warn('⚠️  No redirect location header found!');
        }

        // Step 4: Download the life list CSV
        console.log('\nDownloading life list CSV...');
        const csvUrl = 'https://ebird.org/lifelist?r=world&time=life&fmt=csv';
        console.log('CSV URL:', csvUrl);
        console.log('Using cookies:', cookies.map(c => c.split('=')[0]).join(', '));
        
        const csvResponse = await fetch(csvUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:150.0) Gecko/20100101 Firefox/150.0',
                'Cookie': cookies.join('; '),
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            }
        });

        console.log('CSV response status:', csvResponse.status, csvResponse.statusText);
        console.log('CSV response content-type:', csvResponse.headers.get('content-type'));
        
        if (!csvResponse.ok) {
            throw new Error(`Failed to download CSV: ${csvResponse.status} ${csvResponse.statusText}`);
        }

        const csvContent = await csvResponse.text();
        console.log('CSV content length:', csvContent.length);
        console.log('First 200 chars:', csvContent.substring(0, 200));
        
        // Check if we got CSV or were redirected to login
        if (csvContent.includes('<html') || csvContent.includes('login')) {
            throw new Error('Not authenticated - received HTML instead of CSV');
        }

        // Save to file
        const fs = await import('fs/promises');
        const outputFile = 'ebird_world_life_list.csv';
        await fs.writeFile(outputFile, csvContent, 'utf-8');
        
        console.log(`✓ Life list saved to ${outputFile}`);
        console.log(`  Downloaded ${csvContent.split('\n').length - 1} species`);

    } catch (error) {
        console.error('\n❌ Error occurred:');
        if (error instanceof Error) {
            console.error('  Message:', error.message);
            console.error('  Name:', error.name);
            console.error('  Stack:', error.stack);
            if ('cause' in error) {
                console.error('  Cause:', error.cause);
            }
            if ('code' in error) {
                console.error('  Code:', (error as any).code);
            }
        } else {
            console.error('  Unknown error:', error);
        }
        process.exit(1);
    }
}

// Get credentials from command line
const username = "javaru"//process.argv[2];
const password = "cloasqwsade1"//process.argv[3];

if (!username || !password) {
    console.error('Usage: node --experimental-strip-types download-lifelist.mts <username> <password>');
    process.exit(1);
}

downloadLifeList(username, password);
