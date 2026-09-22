# Bevor v1 Solidity reference

Source: https://github.com/Bevor-Protocol/bevor-v1/tree/f5d76d36a00ba86315cc0f52298610660685a81e

Revision: `f5d76d36a00ba86315cc0f52298610660685a81e`.
The Solidity files below preserve the original source for comparison.

## `Audit.sol`

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/Counters.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@opengsn/contracts/src/ERC2771Recipient.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "hardhat/console.sol";

contract Audit is ERC721Enumerable, Ownable, ERC2771Recipient {

    address[] internal _test;
    uint256 public maxTokensPerWallet = 100;

    mapping(uint256 => bool) public auditRevealed;

    constructor() ERC721("BevorAuditDeliverable", "BAD") {}

    function _msgSender() internal view override(Context, ERC2771Recipient) returns (address sender) {
        sender = ERC2771Recipient._msgSender();
    }

    function _msgData() internal view override(Context, ERC2771Recipient) returns (bytes calldata) {
        return ERC2771Recipient._msgData();
    }
    
    // TODO: Figure out how to secure this function, shouldn't be only owner though.
    function mint(address _to, uint256 tokenId) public {
        _mint(_to, tokenId);
    }

    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 firstTokenId,
        uint256 batchSize
    ) internal virtual override {
        super._beforeTokenTransfer(from, to, firstTokenId, batchSize);
    }

    function _burn(uint256 tokenId) internal override {
        super._burn(tokenId);
    }

    function burn(uint256 tokenId) public onlyOwner {
        _burn(tokenId);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721Enumerable)
        returns (bool) {
        return super.supportsInterface(interfaceId);
    }

    function _baseURI(uint256 tokenId) internal view virtual returns (string memory) {
        if (auditRevealed[tokenId]) {
            return "https://ipfs.io/ipfs/";
        }
        else {
            return "https://api.bevor.io/";
        }
    }

    function tokenURI(uint256 tokenId) public view virtual override returns (string memory) {
        _requireMinted(tokenId);

        string memory baseURI = _baseURI(tokenId);

        return bytes(baseURI).length > 0 ? string(abi.encodePacked(baseURI, Strings.toString(tokenId))) : "";
    }

    // Transfer an NFT ??
    function trustlessHandoff(address from, address to, uint256 tokenId) public {
        auditRevealed[tokenId] = true;
        transferFrom(from, to, tokenId);
    }

    /**
     * @dev Generates a Proof Of Integrity as the keccak256 hash of a human readable {base} and a randomly pre-generated number {salt}.
     */
    function generateProof(string memory base, uint256 salt) public pure returns (uint256) {
        return uint256(keccak256(abi.encodePacked(base, salt)));
    }

    /**
     * @dev Verifies a Proof Of Integrity {proof} against a human readable {base} and a randomly pre-generated number {salt}.
     */
    function verifyProof(uint256 tokenId, string memory base, uint256 salt) public pure returns (bool) {
        return tokenId == generateProof(base, salt);
    }
}
```

## `BevorDAO.sol`

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/governance/Governor.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorSettings.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorCountingSimple.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorVotes.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorVotesQuorumFraction.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorTimelockControl.sol";
import "./IBevorDAO.sol";
import "./IAudit.sol";
import "./Types.sol";
import "./BevorProtocol.sol";

contract BevorDAO is IBevorDAO, Governor, GovernorSettings, GovernorCountingSimple, GovernorVotes, GovernorVotesQuorumFraction, GovernorTimelockControl, Ownable {
    ProposalState public propState;

    // TODO (Blake Hatch) Figure out if these constructor values are good
    constructor(IVotes _token, TimelockController _timelock)
        Governor("BevorGovernor")
        GovernorSettings(7200 /* 1 day */, 50400 /* 1 week */, 0)
        GovernorVotes(_token)
        GovernorVotesQuorumFraction(4)
        GovernorTimelockControl(_timelock)
    {
    }

    BevorProtocol public bevorProtocol;

    function setBevorProtocol(BevorProtocol _protocol) public onlyOwner {
        bevorProtocol = _protocol;
    }

    function isWithdrawFrozen(uint256 proposalId) public view returns (bool) {
        ProposalState proposalState = state(proposalId);
        return proposalState == ProposalState.Pending || proposalState == ProposalState.Active;
    }

    function isVestingInvalidated(uint256 proposalId) public view returns (bool) {
        ProposalState proposalState = state(proposalId);
        return proposalState == ProposalState.Succeeded || proposalState == ProposalState.Queued || proposalState == ProposalState.Executed;
    }

    // The following functions are overrides required by Solidity.
    function votingDelay()
        public
        view
        override(IGovernor, GovernorSettings)
        returns (uint256)
    {
        return super.votingDelay();
    }

    function votingPeriod()
        public
        view
        override(IGovernor, GovernorSettings)
        returns (uint256)
    {
        return super.votingPeriod();
    }

    function quorum(uint256 blockNumber)
        public
        view
        override(IGovernor, GovernorVotesQuorumFraction)
        returns (uint256)
    {
        return super.quorum(blockNumber);
    }

    function state(uint256 proposalId)
        public
        view
        override(Governor, GovernorTimelockControl)
        returns (ProposalState)
    {
        return super.state(proposalId);
    }

    /**
     * Create a proposal for cancelling vesting 
     * @param targets The targets to be executed
     * @param values The first value must be a valid auditId
     * @param calldatas The calldatas to be executed 
     * @param description The description of the proposal to cancel vesting 
     */
    function propose(
        address[] memory targets, 
        uint256[] memory values, 
        bytes[] memory calldatas, 
        string memory description 
    ) 
        public 
        override(Governor, IGovernor, IBevorDAO) 
        returns (uint256) 
    {
        uint256 auditId = values[0];

        (
            address protocolOwner,
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            bool isActive
        ) = bevorProtocol.audits(auditId);

        require(isActive, "Cannot cancel vesting since it hasn't started yet");
        require(msg.sender == protocolOwner, "Cannot propose that the audit is invalid if you are not the protocol owner");

        // Call the propose function from the Governor base contract
        uint256 proposalId = super.propose(targets, values, calldatas, description);

        bevorProtocol.addInvalidatingProposalId(auditId, proposalId);

        return proposalId;
    }

    function proposalThreshold()
        public
        view
        override(Governor, GovernorSettings)
        returns (uint256)
    {
        return super.proposalThreshold();
    }

    function _execute(uint256 proposalId, address[] memory targets, uint256[] memory values, bytes[] memory calldatas, bytes32 descriptionHash)
        internal
        override(Governor, GovernorTimelockControl)
    {
        super._execute(proposalId, targets, values, calldatas, descriptionHash);
    }

    function _cancel(address[] memory targets, uint256[] memory values, bytes[] memory calldatas, bytes32 descriptionHash)
        internal
        override(Governor, GovernorTimelockControl)
        returns (uint256)
    {
        return super._cancel(targets, values, calldatas, descriptionHash);
    }

    function _executor()
        internal
        view
        override(Governor, GovernorTimelockControl)
        returns (address)
    {
        return super._executor();
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(Governor, GovernorTimelockControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
```

## `BevorDAOMock.sol`

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/governance/Governor.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorSettings.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorCountingSimple.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorVotes.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorVotesQuorumFraction.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorTimelockControl.sol";
import "./IBevorDAO.sol";
import "./IAudit.sol";
import "./Types.sol";
import "./BevorProtocol.sol";

contract BevorDAOMock is IBevorDAO, IGovernor, Ownable {
    BevorDAO public bevorDAO;
    BevorProtocol public bevorProtocol;

    constructor(
        IVotes,
        TimelockController
    ) {
    }

    function setBevorProtocol(BevorProtocol _protocol) public onlyOwner {
        bevorProtocol = _protocol;
    }

    function isWithdrawFrozen(uint256 proposalId) public view returns (bool) {
        ProposalState proposalState = state(proposalId);
        return proposalState == ProposalState.Pending || proposalState == ProposalState.Active;
    }

    function isVestingInvalidated(uint256 proposalId) public view returns (bool) {
        ProposalState proposalState = state(proposalId);
        return proposalState == ProposalState.Succeeded || proposalState == ProposalState.Queued || proposalState == ProposalState.Executed;
    }

    // Override the state function to return different states for the first few proposalIds for testing
    function state(
        uint256 proposalId
    ) public view override(IGovernor) returns (ProposalState) {
        if (proposalId == 1) {
            return ProposalState.Pending;
        } else if (proposalId == 2) {
            return ProposalState.Active;
        } else if (proposalId == 3) {
            return ProposalState.Canceled;
        } else if (proposalId == 4) {
            return ProposalState.Executed;
        } else if (proposalId == 5) {
            return ProposalState.Succeeded;
        } else if (proposalId == 6) {
            return ProposalState.Defeated;
        } else {
            return bevorDAO.state(proposalId);
        }
    }

    // Forward all other calls to the BevorDAO instance
    function propose(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        string memory description
    ) public override(IGovernor, IBevorDAO) returns (uint256) {
        return bevorDAO.propose(targets, values, calldatas, description);
    }

    function votingDelay() public view override(IGovernor) returns (uint256) {
        return bevorDAO.votingDelay();
    }

    function votingPeriod() public view override(IGovernor) returns (uint256) {
        return bevorDAO.votingPeriod();
    }

    function quorum(
        uint256 blockNumber
    ) public view override(IGovernor) returns (uint256) {
        return bevorDAO.quorum(blockNumber);
    }

    function proposalThreshold() public view returns (uint256) {
        return bevorDAO.proposalThreshold();
    }

    function supportsInterface(
        bytes4 interfaceId
    ) external view override returns (bool) {}

    function clock() public view override returns (uint48) {}

    function CLOCK_MODE() public view override returns (string memory) {}

    function name() public view virtual override returns (string memory) {}

    function version() public view virtual override returns (string memory) {}

    function COUNTING_MODE()
        public
        view
        virtual
        override
        returns (string memory)
    {}

    function hashProposal(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) public pure virtual override returns (uint256) {}

    function proposalSnapshot(
        uint256 proposalId
    ) public view virtual override returns (uint256) {}

    function proposalDeadline(
        uint256 proposalId
    ) public view virtual override returns (uint256) {}

    function proposalProposer(
        uint256 proposalId
    ) public view virtual override returns (address) {}

    function getVotes(
        address account,
        uint256 timepoint
    ) public view virtual override returns (uint256) {}

    function getVotesWithParams(
        address account,
        uint256 timepoint,
        bytes memory params
    ) public view virtual override returns (uint256) {}

    function hasVoted(
        uint256 proposalId,
        address account
    ) public view virtual override returns (bool) {}

    function execute(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) public payable virtual override returns (uint256 proposalId) {}

    function cancel(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) public virtual override returns (uint256 proposalId) {}

    function castVote(
        uint256 proposalId,
        uint8 support
    ) public virtual override returns (uint256 balance) {}

    function castVoteWithReason(
        uint256 proposalId,
        uint8 support,
        string calldata reason
    ) public virtual override returns (uint256 balance) {}

    function castVoteWithReasonAndParams(
        uint256 proposalId,
        uint8 support,
        string calldata reason,
        bytes memory params
    ) public virtual override returns (uint256 balance) {}

    function castVoteBySig(
        uint256 proposalId,
        uint8 support,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) public virtual override returns (uint256 balance) {}

    function castVoteWithReasonAndParamsBySig(
        uint256 proposalId,
        uint8 support,
        string calldata reason,
        bytes memory params,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) public virtual override returns (uint256 balance) {}
}
```

## `BevorProtocol.sol`

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// OpenZeppelin dependencies
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/governance/IGovernor.sol";
import "hardhat/console.sol";
import "./IAudit.sol";
import "./IBevorDAO.sol";
import "./BevorDAO.sol";
import "./IBevorDAO.sol";
import "./Types.sol";

/**
 * @title AuditPayment
 */
contract BevorProtocol is Ownable, ReentrancyGuard {
    struct VestingSchedule {
      address auditor;
      uint256 amount;
      uint256 withdrawn;
      uint256 auditId;
    }

    uint256[] public vestingSchedulesIds;
    mapping(uint256 => Audit) public audits;
    mapping(uint256 => uint256[]) public auditToVesting;
    mapping(uint256 => VestingSchedule) public vestingSchedules;
    mapping(address => uint256) public holdersVestingCount;
    address public nft;
    address public dao;

    event VestingScheduleCreated(
      address indexed ProtocolOwner,
      address indexed auditor,
      string finding,
      uint256 cliff,
      uint256 start,
      uint256 duration,
      uint256 slicePeriodSeconds,
      uint256 amountTotal,
      ERC20 token,
      uint256 tokenId
    );

    /**
     * @dev Emitted when an audit is created with a unique identifier.
     * @param auditId The unique identifier for the audit.
     */
    event AuditCreated(uint256 indexed auditId);

    /**
     * @dev Creates a vesting contract.
     * @param dao_ address of the Bevor DAO that controls
     */
    constructor(address dao_, address nft_) {
      // Check that the token address is not 0x0.
      require(address(dao_) != address(0x0));
      require(address(nft_) != address(0x0));
      dao = dao_;
      nft = nft_;
    }

    modifier onlyDAO() {
      require(msg.sender == address(dao));
        _;
    }

    /**
     * @dev This function is called for plain Ether transfers, i.e. for every call with empty calldata.
     */
    receive() external payable {}

    /**
     * @dev Fallback function is executed if none of the other functions match the function
     * identifier or no data was provided with the function call.
     */
    fallback() external payable {}

    /**
     * @dev Sets a new DAO address.
     * @param newDao The address of the new DAO.
     */
    function setDaoAddress(address newDao) external {
        require(newDao != address(0), "New DAO address cannot be the zero address");
        dao = newDao;
    }

    /**
     * @dev Modifies the invalidating proposal ID in an existing audit.
     * @param auditId The ID of the audit to modify.
     * @param invalidatingProposalId The new invalidating proposal ID to set.
     */
    function addInvalidatingProposalId(uint256 auditId, uint256 invalidatingProposalId) external onlyDAO {
        Audit storage targetAudit = audits[auditId];

        require(targetAudit.isActive, "Cannot modify since the audit hasn't started yet");
        require(targetAudit.invalidatingProposalId == 0, "Cannot modify the invalidating proposal ID more than once");

        targetAudit.invalidatingProposalId = invalidatingProposalId;
    }

    /**
     * @dev creates the locked version of the audit once all parties agree on terms
     * also creates the vesting schedules. Marks all as inactive.
     * @param auditors an array of auditors to conduct the audit
     * @param cliff the cliff duration
     * @param details a string hash of the protocol owner provided audit details
     * @param amount total price of the audit
     * @param token ERC20 token to be used for escrow + payment
     * @param salt a random string
     */
    function prepareAudit(
        address[] memory auditors,
        uint256 cliff,
        uint256 duration,
        string  memory details,
        uint256 amount,
        ERC20 token,
        string memory salt
      ) public {
        require(bytes(details).length > 0, "details must be provided");
        require(auditors.length > 0, "at least 1 auditor must be provided");
        require(duration > 0, "TokenVesting: duration must be > 0");
        require(amount > 0, "TokenVesting: amount must be > 0");
        require(duration >= cliff, "TokenVesting: duration must be >= cliff");

      uint256 decimals = ERC20(token).decimals();

      // we handle the decimal conversion within generateAuditId() directly.
      uint256 auditId = generateAuditId(
        msg.sender,
        auditors,
        cliff,
        duration,
        details,
        amount,
        token,
        salt
      );

      audits[auditId] = Audit(
        msg.sender,
        token,
        amount * (10 ** decimals),
        duration,
        cliff,
        0,
        0,
        0,
        false
      );

      uint256[] memory auditorArr = new uint256[](auditors.length);

      for (uint256 i = 0; i < auditors.length; i++) {
        // we'll assume identical payout per auditor.
        address auditor = auditors[i];
        uint256 vestingScheduleId = computeNextVestingScheduleIdForHolder(auditor);
        uint256 currentVestingCount = holdersVestingCount[auditor];
        holdersVestingCount[auditor] = currentVestingCount + 1;
        vestingSchedulesIds.push(vestingScheduleId);
        
        auditorArr[i] = vestingScheduleId;

        vestingSchedules[vestingScheduleId] = VestingSchedule(
          auditor,
          amount * (10 ** decimals) / auditors.length,
          0,
          auditId
        );
      }

      auditToVesting[auditId] = auditorArr;

      emit AuditCreated(auditId);
    }

    /**
     * @dev Generates a Proof Of Integrity as the keccak256 hash of the concatenated string of all vesting fields.
     * @param auditee The address of the auditee.
     * @param auditors The addresses of the auditors.
     * @param cliff The cliff period in seconds.
     * @param duration The duration of the vesting period in seconds.
     * @param details The hash of the provided audit details.
     * @param amount The total amount of tokens to be released at the end of the vesting.
     * @param token The address of the ERC20 token being vested.
     * @param salt The random salt uint256
     * @return The keccak256 hash of the concatenated vesting data.
     */
    function generateAuditId(
      address auditee,
      address[] memory auditors,
      uint256 cliff,
      uint256 duration,
      string  memory details,
      uint256 amount,
      ERC20 token,
      string memory salt
    ) public view returns (uint256) {
      uint256 decimals = ERC20(token).decimals();
      return uint256(keccak256(abi.encodePacked(
        auditee,
        auditors,
        cliff,
        duration,
        details,
        amount * (10 ** decimals),
        token,
        salt
      )));
    }

    /**
     * @dev Generates a Proof of Integrity as the keccak256 hash of the original audit, concatenated with additional findings.
     * @param auditId auditId of Audit constructor
     * @param findings findings produced by auditors
     */
    function generateTokenId(
      uint256 auditId,
      string[] memory findings
    ) public pure returns (uint256) {
        bytes memory findingsData = "";
        for (uint i = 0; i < findings.length; i++) {
          findingsData = abi.encodePacked(findingsData, findings[i]);
        }
        return uint256(keccak256(abi.encodePacked(
          auditId,
          findingsData
        )));
    }

    /**
     * @dev Posts findings to the original audit, called by protocol owner of that audit. Kicks off vesting.
     * @param findings findings produced by auditors
     * @param auditId auditId of interest to post findings to
     */
    function revealFindings(string[] memory findings, uint256 auditId) public {
      // removed passing auditors[] as a parameter. spoofing this is expensive, and we already have information
      // about which auditors belong to each audit, which is verifiable through the auditId generation.
      // further, it's not even used to generate the tokenId.

      Audit storage targetAudit = audits[auditId];
      uint256[] storage schedules = auditToVesting[auditId];

      require(targetAudit.protocolOwner == msg.sender, "Only the auditee can mint this NFT");
      require(schedules.length == findings.length, "incorrect number of auditors passed");
      require(!targetAudit.isActive, "audit schedule is already active");

      targetAudit.token.transferFrom(msg.sender, address(this), targetAudit.amount);

      require(
        targetAudit.token.balanceOf(address(this)) >= targetAudit.amount,
        "TokenVesting: cannot create vesting schedule because insufficient tokens"
      );
      
      targetAudit.isActive = true;
      targetAudit.start = block.timestamp;

      for (uint256 i = 0; i < findings.length; i++) {
        string memory finding = findings[i];
        require(bytes(finding).length > 0, "cannot provide an empty finding");
      }

      // can easily be recreated starting from a source Audit struct.
      uint256 tokenId = generateTokenId(auditId, findings);

      IAudit(nft).mint(msg.sender, tokenId);

      targetAudit.nftTokenId = tokenId;
    }

    /**
      * @dev If vesting proposal exits and is in the voting or execution stages. Otherwise will return false and allow vesting. 
      */
    function isWithdrawPaused(uint256 auditId) public view returns (bool) {
      Audit storage targetAudit = audits[auditId];

      if (!targetAudit.isActive) {
        // don't even look in the DAO, as entry won't exist. Just return immediately.
        // Captures the case for auditID that doesn't exist, or auditID where isActive is false.
        return false;
      }

      return IBevorDAO(dao).isWithdrawFrozen(targetAudit.invalidatingProposalId);
    }

    /**
     * @notice Release vested amount of tokens.
     * @param vestingScheduleId the vesting schedule identifier
     */
    function withdraw(uint256 vestingScheduleId) public nonReentrant {
      VestingSchedule storage vestingSchedule = vestingSchedules[vestingScheduleId];
      Audit storage parentAudit = audits[vestingSchedule.auditId];

      bool isAuditor = msg.sender == vestingSchedule.auditor;
      bool isProtocolOwner = msg.sender == parentAudit.protocolOwner;
      bool isReleasor = (msg.sender == owner());

      bool invalidated = IBevorDAO(dao).isVestingInvalidated(parentAudit.invalidatingProposalId);

      if (isProtocolOwner) {
        require(invalidated, "TokenVesting: audit must be invalidated for protocol owner to release vested tokens");
      } else {
        require(
          isAuditor || isReleasor,
          "TokenVesting: only auditor and owner can release vested tokens"
        );
      }

      // COME BACK TO THIS.
      if (!invalidated) {
        require(!IBevorDAO(dao).isWithdrawFrozen(parentAudit.invalidatingProposalId), "Withdrawing is paused due to pending proposal cannot withdraw tokens");
      }

      uint256 vestedAmount = _computeReleasableAmount(vestingSchedule);
      vestingSchedule.withdrawn += vestedAmount;

      if (invalidated) {
        parentAudit.token.transfer(parentAudit.protocolOwner, vestedAmount);
      } else {
        parentAudit.token.transfer(vestingSchedule.auditor, vestedAmount);
      }
    }

    /**
     * @dev Returns the number of vesting schedules associated to an auditor.
     * @param _auditor address of auditor
     * @return count the number of vesting schedules
     */
    function getVestingSchedulesCountByAuditor(
        address _auditor
    ) external view returns (uint256) {
        return holdersVestingCount[_auditor];
    }

    /**
     * @dev Returns the vesting schedule id at the given index.
     * @param index the index of the vesting schedule
     * @return vestingId vesting id
     */
    function getVestingIdAtIndex(
      uint256 index
    ) external view returns (uint256) {
      require(index < getVestingSchedulesCount(), "TokenVesting: index out of bounds");
      return vestingSchedulesIds[index];
    }

    /**
     * @notice Returns the vesting schedule information for a given holder and index.
     * @param auditor auditor to get the vesting schedule for
     * @param index index of the vesting schedule for the auditor.
     * @return vestingSchedule the vesting schedule structure information
     */
    function getVestingScheduleByAddressAndIndex(
      address auditor,
      uint256 index
    ) external view returns (VestingSchedule memory) {
      return
        getVestingSchedule(
          computeVestingScheduleIdForAddressAndIndex(auditor, index)
        );
    }

    function getVestingScheduleIdByAddressAndAudit(address auditor, uint256 auditId) public view returns (uint256) {
      uint256[] storage schedules = auditToVesting[auditId];
      for (uint256 i = 0; i < schedules.length; i++) {
        VestingSchedule storage schedule = vestingSchedules[schedules[i]];
        if (schedule.auditor == auditor) {
          return schedules[i];
        }
      }
      revert("No vesting schedule found for this auditor in this audit");
    }

    /**
     * @dev Returns the number of vesting schedules managed by this contract.
     * @return total the total number of vesting schedules
     */
    function getVestingSchedulesCount() public view returns (uint256) {
      return vestingSchedulesIds.length;
    }

    /**
     * @notice Computes the vested amount of tokens for the given vesting schedule identifier.
     * @param vestingScheduleId id to compute releaseable amounts for.
     * @return amount the vested amount since last withdrawal
     */
    function computeReleasableAmount(uint256 vestingScheduleId) public view returns (uint256) {
      VestingSchedule storage vestingSchedule = vestingSchedules[vestingScheduleId];
      return _computeReleasableAmount(vestingSchedule);
    }

    /**
     * @notice Returns the vesting schedule information for a given identifier.
     * @return the vesting schedule structure information
     */
    function getVestingSchedule(uint256 vestingScheduleId) public view returns (VestingSchedule memory) {
      return vestingSchedules[vestingScheduleId];
    }


    /**
     * @notice helper function for returning the dynamically sized auditToVesting mapping.
     * @param auditId auditId to return vestingSchedules for.
     */
    function getVestingSchedulesForAudit(uint256 auditId) public view returns (uint256[] memory) {
      return auditToVesting[auditId];
    }

    /**
     * @dev Computes the next vesting schedule identifier for a given holder address.
     */
    function computeNextVestingScheduleIdForHolder(address holder) public view returns (uint256) {
      return computeVestingScheduleIdForAddressAndIndex(
        holder,
        holdersVestingCount[holder]
      );
    }

    /**
     * @dev Returns the last vesting schedule for a given holder address.
     */
    function getLastVestingScheduleForHolder(address holder) external view returns (VestingSchedule memory) {
      return vestingSchedules[
        computeVestingScheduleIdForAddressAndIndex(
          holder,
          holdersVestingCount[holder] - 1
        )
      ];
    }

    /**
     * @dev Computes the vesting schedule identifier for an address and an index.
     */
    function computeVestingScheduleIdForAddressAndIndex(
      address holder,
      uint256 index
    ) public pure returns (uint256) {
      return uint256(keccak256(abi.encodePacked(holder, index)));
    }

    /**
     * @dev Computes the releasable amount of tokens for a vesting schedule.
     * @return the amount of releasable tokens
     */
    function _computeReleasableAmount(
      VestingSchedule memory vestingSchedule
    ) internal view returns (uint256) {
      // Parent audit retains baseline audit terms.
      Audit storage parentAudit = audits[vestingSchedule.auditId];

      if (!parentAudit.isActive) {
        // captures inactive audits, or audits that don't exist.
        return 0;
      }

      if (isWithdrawPaused(vestingSchedule.auditId)) {
        // captures those that are frozen.
        return 0;
      }

      uint256 currentTime = block.timestamp;
      // If the current time is before the cliff, no tokens are releasable.
      if (currentTime < parentAudit.cliff + parentAudit.start) {
        return 0;
      }
      // If the current time is after the vesting period, all tokens are releasable,
      // minus the amount already released.
      else if (currentTime >= parentAudit.start + parentAudit.duration) {
        return vestingSchedule.amount - vestingSchedule.withdrawn;
      }
      // Otherwise, some tokens are releasable.
      else {
        uint256 m = vestingSchedule.amount / parentAudit.duration;
        uint256 x = currentTime - parentAudit.start;
        uint256 y = m * x;
        // Subtract the amount already released and return.
        uint256 releasable = y - vestingSchedule.withdrawn;
        return releasable;
      }
    }
}
```

## `BevorToken.sol`

```solidity
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.10;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract BevorToken is ERC20 {

    constructor(
        uint256 totalSupply_,
        string memory name_,
        string memory symbol_
    ) ERC20(name_, symbol_) {
        _mint(msg.sender, totalSupply_);
    }

}
```

## `IAudit.sol`

```solidity
// SPDX-License-Identifier: MIT
// OpenZeppelin Contracts (last updated v4.5.0) (token/ERC721/extensions/IERC721Enumerable.sol)

pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";

/**
 * @title ActionItem standard for action items triggered by smart agreement being signed.
 */
interface IAudit is IERC721 {
    /**
     * @dev Creates a new agreement
     */
    function mint(address _to, uint256 tokenId) external;

    /**
     * @dev Destroys the audit.
     */
    function burn(uint256 tokenId) external;

    /**
     * @dev Creates a new agreement
     */
    function trustlessHandoff(address _from, address _to, uint256 _tokenId) external;

}
```

## `IBevorDAO.sol`

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20; 

/**
 * This interface allows out-of-the box DAO structures
 */
interface IBevorDAO {

    /**
      * Returns whether the proposal is in the voting state
      *
      */
    function isWithdrawFrozen(uint256 proposalId) external view returns (bool);

    /**
      * Returns whether the proposal has been voted true
      *
      */
    function isVestingInvalidated(uint256 proposalId) external view returns (bool);

    /**
      * Propose a new proposal
      *
      */
    function propose(address[] memory targets, uint256[] memory values, bytes[] memory calldatas, string memory description) external returns (uint256);
}
```

## `ManualDAO.sol`

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20; 

import "@openzeppelin/contracts/governance/IGovernor.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./IBevorDAO.sol";
import "./Types.sol";
import "./BevorProtocol.sol";

contract ManualDAO is IBevorDAO, Ownable {
    mapping(uint256 => bool) public proposalFrozen;
    mapping(uint256 => bool) public proposalInvalidated;
    uint256 public proposals = 0;

    BevorProtocol public bevorProtocol;

    function setBevorProtocol(BevorProtocol _protocol) public onlyOwner {
        bevorProtocol = _protocol;
    }

    // These these below to only be set by the protocol contract
    function setProposalFrozen(uint256 proposalId, bool frozen) public onlyOwner {
        proposalFrozen[proposalId] = frozen;
    }

    function setProposalInvalidated(uint256 proposalId, bool invalidated) public onlyOwner {
        require(isWithdrawFrozen(proposalId), "Proposal must be frozen to invalidate.");
        proposalInvalidated[proposalId] = invalidated;
    }

    function isWithdrawFrozen(uint256 proposalId) public view returns (bool) {
        return proposalFrozen[proposalId];
    }

    function isVestingInvalidated(uint256 proposalId) public view returns (bool) {
        return proposalInvalidated[proposalId];
    }

    function propose(address[] memory, uint256[] memory values, bytes[] memory, string memory) public returns (uint256) {
        proposals += 1;
        proposalFrozen[proposals] = true;

        uint256 auditId = values[0];

        // address protocolOwner
        // ERC20 token
        // uint256 amount
        // uint256 duration
        // uint256 cliff
        // uint256 start
        // uint256 nftTokenId
        // uint256 invalidatingProposalId
        // bool isActive
        (
            address protocolOwner,
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            bool isActive
        ) = bevorProtocol.audits(auditId);

        require(isActive, "Cannot cancel vesting since it hasn't started yet");
        require(msg.sender == protocolOwner, "Cannot propose that the audit is invalid if you are not the protocol owner");

        bevorProtocol.addInvalidatingProposalId(auditId, proposals);

        return proposals;
    }
}
```

## `TimelockController.sol`

```solidity
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import "@openzeppelin/contracts/governance/TimelockController.sol";

contract BevorTimelockController is TimelockController {

    constructor(
        uint256 minDelay, address[] memory proposers, address[] memory executors, address admin
    ) TimelockController(minDelay, proposers, executors, admin) {
    }

}
```

## `Types.sol`

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// Let's assume vesting terms are globally set by the Audit itself.
struct Audit {
    address protocolOwner;
    ERC20 token;
    uint256 amount;
    uint256 duration;
    uint256 cliff;
    uint256 start;
    uint256 nftTokenId;
    uint256 invalidatingProposalId;
    bool isActive;
}
```
