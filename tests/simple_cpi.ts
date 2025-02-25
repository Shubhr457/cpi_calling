import * as anchor from '@coral-xyz/anchor';
import { Program, web3 } from '@coral-xyz/anchor';
import { SimpleCpi } from '../target/types/simple_cpi';
import { Escrow } from '../target/types/escrow';
import { TOKEN_PROGRAM_ID, createMint, createAssociatedTokenAccount, mintTo } from '@solana/spl-token';
import { assert } from 'chai';
import * as fs from 'fs';
import * as path from 'path';

describe('simple_cpi', () => {
  // Configure connection to devnet
  const connection = new web3.Connection(
    "https://api.devnet.solana.com", 
    { commitment: "confirmed" }
  );
  
  // Load wallet with error handling
  let walletKeypair;
  try {
    const secretKeyPath = path.resolve('/home/shubh/.config/solana/id.json');
    const secretKey = JSON.parse(fs.readFileSync(secretKeyPath, 'utf8'));
    walletKeypair = web3.Keypair.fromSecretKey(new Uint8Array(secretKey));
    console.log("Wallet loaded successfully:", walletKeypair.publicKey.toString());
  } catch (error) {
    console.error("Failed to load wallet, generating a new one:", error);
    walletKeypair = web3.Keypair.generate();
    console.log("Using generated keypair:", walletKeypair.publicKey.toString());
  }

  // Setup the provider with our explicit connection
  const wallet = new anchor.Wallet(walletKeypair);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  
  anchor.setProvider(provider);

  // Load the programs
  const simpleCpiProgram = anchor.workspace.SimpleCpi as Program<SimpleCpi>;
  const escrowProgram = anchor.workspace.Escrow as Program<Escrow>;

  // Generate keypairs for testing
  const owner = web3.Keypair.generate();
  const allowedAddress = web3.Keypair.generate();
  let mint;
  let ownerTokenAccount;
  let escrowTokenAccount;
  let escrowAccount;

  before(async () => {
    try {
      console.log("Provider wallet public key:", provider.wallet.publicKey.toString());
      
      console.log("Connecting to Solana devnet...");
      const version = await connection.getVersion();
      console.log("Connected to Solana devnet. Version:", version);
      
      // Check wallet balance
      const walletBalance = await connection.getBalance(provider.wallet.publicKey);
      console.log(`Wallet balance: ${walletBalance / web3.LAMPORTS_PER_SOL} SOL`);
      
      // Fund the test owner account
      console.log("Funding owner account...");
      const ownerAirdrop = await connection.requestAirdrop(
        owner.publicKey,
        1 * web3.LAMPORTS_PER_SOL
      );
      await connection.confirmTransaction(ownerAirdrop);
      console.log("Owner account funded:", owner.publicKey.toString());
      
      // Create mint
      console.log("Creating token mint...");
      mint = await createMint(
        connection,
        walletKeypair,
        provider.wallet.publicKey,
        null,
        6
      );
      console.log("Mint created:", mint.toString());

      // Derive escrow account PDA
      const [escrowPda, _bump] = web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("escrow"),
          owner.publicKey.toBuffer(),
          mint.toBuffer(),
        ],
        escrowProgram.programId
      );
      escrowAccount = escrowPda;
      console.log("Escrow account PDA:", escrowAccount.toString());

      // Create token accounts
      console.log("Creating owner token account...");
      ownerTokenAccount = await createAssociatedTokenAccount(
        connection,
        walletKeypair,
        mint,
        owner.publicKey
      );
      console.log("Owner token account created:", ownerTokenAccount.toString());

      console.log("Creating escrow token account...");
      escrowTokenAccount = await createAssociatedTokenAccount(
        connection,
        walletKeypair,
        mint,
        wallet.publicKey  // Use wallet as owner of escrow token account
      );
      console.log("Escrow token account created:", escrowTokenAccount.toString());

      // Mint tokens to owner account
      console.log("Minting tokens to owner...");
      await mintTo(
        connection,
        walletKeypair,
        mint,
        ownerTokenAccount,
        wallet.publicKey,
        2_000_000
      );
      console.log("Tokens minted to owner account");

      // IMPORTANT: Initialize the escrow account first
      console.log("Initializing escrow account...");
      await escrowProgram.methods
        .initialize()
        .accounts({
          user: owner.publicKey,
          mint: mint,
          escrowAccount: escrowAccount,
          escrowTokenAccount: escrowTokenAccount,
          systemProgram: web3.SystemProgram.programId,
        })
        .signers([owner])
        .rpc();
      console.log("Escrow account initialized");
      
    } catch (error) {
      console.error("Setup failed with error:", error);
      throw error;
    }
  });

  it('Initialize and create an allowance', async () => {
    console.log("Starting test: Initialize and create an allowance");
    
    try {
      // Generate PDA for allowance account
      const [allowanceAccountPda, _] = web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("allowance"),
          owner.publicKey.toBuffer(),
          allowedAddress.publicKey.toBuffer(),
          mint.toBuffer()
        ],
        simpleCpiProgram.programId
      );
      
      console.log("Creating allowance...");
      await simpleCpiProgram.methods
        .createAllowance(new anchor.BN(1_000_000), new anchor.BN(500_000))
        .accounts({
          owner: owner.publicKey,
          allowedAddress: allowedAddress.publicKey,
          ownerTokenAccount,
          escrowTokenAccount,
          escrowAccount,
          allowanceAccount: allowanceAccountPda,
          escrowProgram: escrowProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: web3.SystemProgram.programId,
        })
        .signers([owner])
        .rpc();
      
      console.log("Allowance created successfully");

      // Verify allowance account state
      const allowanceAccountData = await simpleCpiProgram.account.allowanceAccount.fetch(
        allowanceAccountPda
      );

      assert.ok(allowanceAccountData.owner.equals(owner.publicKey));
      assert.ok(allowanceAccountData.allowedAddress.equals(allowedAddress.publicKey));
      assert.equal(allowanceAccountData.allowedAmount.toNumber(), 500_000);
      assert.ok(allowanceAccountData.mint.equals(mint));
      
      console.log("Allowance verification successful");
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  // Add rest of your tests here...
  
  // Set timeout for longer tests
});